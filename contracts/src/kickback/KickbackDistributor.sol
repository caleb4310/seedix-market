// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SeedixRoles} from "../access/SeedixRoles.sol";
import {SeedixConstants as C} from "../libraries/SeedixConstants.sol";
import {LaunchHook} from "../hook/LaunchHook.sol";
import {LaunchToken} from "../token/LaunchToken.sol";

/// @notice Hourly Kickback rounds. Epochs are timestamp windows, never block ranges.
///         The publisher funds a round and posts the holder merkle root. After the review hour
///         the keeper pushes that root in bounded batches. Dust, skipped contracts, and anything
///         still unallocated roll into the next round. A transfer that reverts is credited to the
///         holder and does not stop the batch. Keeper gas is paid from the round in the pair token,
///         at most 2% of the round, and that ceiling is enforced here.
///
///         Conservation, once a round is closed:
///         `pushed + claimable + rollover == funded - gasPaid`.
///         Before the seal, `pending` is the unclassified remainder and the same identity holds
///         with `pending` on the left. `gasPaid` never exceeds 2% of `funded`.
contract KickbackDistributor {
    using SafeERC20 for IERC20;

    error NotPublisher();
    error NotGuardian();
    error NotTimelock();
    error NotInitializer();
    error NotKeeper();
    error NotAdmin();
    error BadEpoch();
    error Cap();
    error ReviewOpen();
    error ReviewClosed();
    error Excluded();
    error BadProof();
    error AlreadyClaimed();
    error SweepNotEnabled();
    error Batch();
    error Dust();
    error Sealed();
    error GasCapFixed();
    error Locked();
    error Nothing();
    error TransferFailed();

    /// @dev A batch cannot grow with the holder set. Callers repeat `push` until the round is done.
    uint256 public constant MAX_BATCH = 32;
    /// @dev 200 / 10_000 = 2%. Mainnet cannot raise this. Testnet can only lower it.
    uint256 public constant MAX_GAS_CAP_BPS = 200;
    uint256 public constant BPS = 10_000;
    /// @dev Stipend for one token transfer so a reverting receiver cannot consume the batch.
    uint256 public constant TRANSFER_GAS = 200_000;
    /// @dev Covers the reimbursement transfer that happens after `gasleft` is sampled.
    uint256 public constant GAS_OVERHEAD = 40_000;

    struct Epoch {
        uint128 funded;
        uint128 claimed;
        uint64 start;
        uint64 end;
        uint64 postedAt;
        bytes32 root;
        bytes32 manifestHash;
        bool cancelled;
    }

    /// @notice Classification of one round. `pending` is zero after `seal`.
    struct Round {
        uint256 funded;
        uint256 pushed;
        uint256 claimable;
        uint256 rollover;
        uint256 gasPaid;
        uint256 pending;
    }

    enum SendResult {
        Ok,
        Failed,
        Moved
    }

    event KickbackFunded(PoolId indexed poolId, uint64 indexed epoch, uint256 amount);
    event RolloverApplied(PoolId indexed poolId, uint64 indexed epoch, uint256 amount);
    event RootPosted(PoolId indexed poolId, uint64 indexed epoch, bytes32 root, bytes32 manifestHash);
    event KickbackCancelled(PoolId indexed poolId, uint64 indexed epoch, uint256 refunded);
    event KickbackClaimed(PoolId indexed poolId, uint64 indexed epoch, address account, uint256 amount);
    event Pushed(PoolId indexed poolId, uint64 indexed epoch, address indexed account, uint256 amount);
    event Rolled(PoolId indexed poolId, uint64 indexed epoch, address indexed account, uint256 amount);
    event ClaimableCredited(PoolId indexed poolId, uint64 indexed epoch, address indexed account, uint256 amount);
    event FailedPull(PoolId indexed poolId, uint64 indexed epoch, address indexed account, uint256 amount);
    event GasReimbursed(PoolId indexed poolId, uint64 indexed epoch, address indexed keeper, uint256 amount);
    event RoundSealed(PoolId indexed poolId, uint64 indexed epoch, uint256 rolled);
    event KeeperSet(address indexed previous, address indexed next);
    event AllowlistSet(address indexed account, bool allowed);
    event DustSet(uint256 threshold);
    event GasCapSet(uint256 bps);

    SeedixRoles public immutable roles;
    address public immutable initializer;
    LaunchHook public hook;
    address public publisher;
    address public poolManager;
    address public locker;
    address public vault;
    address public buybackExecutor;
    address public keeper;
    bool public initialKeeperUsed;

    uint256 public roundCap;
    uint256 public hourlyCap;
    uint256 public hourStart;
    uint256 public fundedThisHour;
    /// @notice Amounts strictly below this roll into the next round. Default is 1e6 wei.
    uint256 public dustThreshold = 1_000_000;
    /// @notice Share of a round that can reimburse keeper gas. Defaults to the 2% ceiling.
    uint256 public gasCapBps = MAX_GAS_CAP_BPS;

    mapping(PoolId => mapping(uint64 => Epoch)) public epochs;
    mapping(PoolId => uint64) public nextEpoch;
    mapping(PoolId => uint64) public lastEnd;
    mapping(PoolId => mapping(uint64 => mapping(address => bool))) public claimed;
    mapping(address => uint256) public liabilities;

    /// @notice Successful keeper pushes, plus pulls of previously failed transfers.
    mapping(PoolId => mapping(uint64 => uint256)) public paidOut;
    /// @notice Failed pushes still owed to holders, summed for the round.
    mapping(PoolId => mapping(uint64 => uint256)) public claimableEpoch;
    /// @notice Per-holder credit created when a push transfer reverts.
    mapping(PoolId => mapping(uint64 => mapping(address => uint256))) public claimable;
    /// @notice Dust, skipped holders, and the closed remainder. Already moved toward the next round.
    mapping(PoolId => mapping(uint64 => uint256)) public rolloverEpoch;
    mapping(PoolId => mapping(uint64 => uint256)) public gasPaidEpoch;
    mapping(PoolId => mapping(uint64 => bool)) public roundClosed;
    /// @notice Pair tokens waiting to be included in the next `fund` for this pool.
    mapping(PoolId => uint256) public poolCarry;
    /// @notice Contracts the timelock has allowed to receive a push. Team wallets stay excluded.
    mapping(address => bool) public allowlisted;

    uint256 private _entered;

    modifier nonReentrant() {
        if (_entered != 0) revert Locked();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(SeedixRoles roles_, address publisher_, uint256 roundCap_, uint256 hourlyCap_, address initializer_) {
        if (publisher_ == address(0) || roundCap_ == 0 || hourlyCap_ == 0 || initializer_ == address(0)) {
            revert BadEpoch();
        }
        roles = roles_;
        publisher = publisher_;
        roundCap = roundCap_;
        hourlyCap = hourlyCap_;
        initializer = initializer_;
    }

    function wire(LaunchHook hook_, address poolManager_, address locker_, address vault_, address buybackExecutor_)
        external
    {
        if (msg.sender != initializer || address(hook) != address(0)) revert NotInitializer();
        hook = hook_;
        poolManager = poolManager_;
        locker = locker_;
        vault = vault_;
        buybackExecutor = buybackExecutor_;
    }

    function setPublisher(address next) external {
        if (msg.sender != address(roles.timelock()) || next == address(0)) revert NotTimelock();
        publisher = next;
    }

    function setRoundCap(uint256 next) external {
        if (msg.sender == roles.guardian()) {
            if (next == 0 || next >= roundCap) revert Cap();
        } else if (msg.sender != address(roles.timelock())) {
            revert NotTimelock();
        }
        roundCap = next;
    }

    /// @notice Admin can grant or revoke the kickback keeper. The zero address revokes it.
    ///         Mainnet must timelock the grant. This testnet build applies it immediately.
    ///         Revocation stays immediate there too.
    function setKeeper(address next) external {
        if (msg.sender != roles.admin()) revert NotAdmin();
        emit KeeperSet(keeper, next);
        keeper = next;
    }

    /// @notice Deploy-time grant. One call from the initializer, even when `next` is zero,
    ///         which only burns the right so the deployer cannot grant a keeper later.
    function grantKeeper(address next) external {
        if (msg.sender != initializer || initialKeeperUsed) revert NotInitializer();
        initialKeeperUsed = true;
        if (next == address(0)) return;
        emit KeeperSet(address(0), next);
        keeper = next;
    }

    /// @notice Testnet only. The value cannot exceed 2%. The guardian can only lower it.
    function setGasCapBps(uint256 next) external {
        if (block.chainid != 99801 && block.chainid != 31337) revert GasCapFixed();
        if (next > MAX_GAS_CAP_BPS) revert Cap();
        if (msg.sender == roles.guardian()) {
            if (next >= gasCapBps) revert Cap();
        } else if (msg.sender != address(roles.timelock())) {
            revert NotTimelock();
        }
        gasCapBps = next;
        emit GasCapSet(next);
    }

    /// @notice The guardian can only raise the threshold, which sends more dust forward.
    function setDustThreshold(uint256 next) external {
        if (msg.sender == roles.guardian()) {
            if (next <= dustThreshold) revert Cap();
        } else if (msg.sender != address(roles.timelock())) {
            revert NotTimelock();
        }
        dustThreshold = next;
        emit DustSet(next);
    }

    /// @notice Timelock allowlist for a contract holder. Infrastructure and team wallets cannot be listed.
    function setAllowlist(address account, bool allowed) external {
        if (msg.sender != address(roles.timelock())) revert NotTimelock();
        if (account == address(0) || account.code.length == 0) revert BadEpoch();
        if (isExcluded(account)) revert Excluded();
        allowlisted[account] = allowed;
        emit AllowlistSet(account, allowed);
    }

    function fund(PoolId id, uint128 amount) external nonReentrant returns (uint64 epochId) {
        if (msg.sender != publisher) revert NotPublisher();
        uint256 carry = poolCarry[id];
        if ((amount == 0 && carry == 0) || amount > roundCap) revert Cap();
        if (amount > 0) _accountHour(amount);
        (,,,,, uint40 launchTime,) = hook.config(id);
        if (launchTime == 0) revert BadEpoch();

        uint256 window = C.REVIEW_WINDOW;
        uint64 cursor = lastEnd[id] == 0 ? uint64(launchTime) : lastEnd[id];
        if (block.timestamp < uint256(cursor) + window) revert BadEpoch();
        uint256 elapsed = block.timestamp - uint256(cursor);
        uint256 closedEnd = block.timestamp - (elapsed % window);
        if (closedEnd < uint256(cursor) + window) revert BadEpoch();
        uint64 end = uint64(closedEnd);
        uint64 start = end - uint64(window);

        uint256 pot = uint256(amount) + carry;
        if (pot > type(uint128).max) revert Cap();
        poolCarry[id] = 0;

        epochId = ++nextEpoch[id];
        epochs[id][epochId] = Epoch({
            funded: uint128(pot),
            claimed: 0,
            start: start,
            end: end,
            postedAt: 0,
            root: bytes32(0),
            manifestHash: bytes32(0),
            cancelled: false
        });
        lastEnd[id] = end;

        if (amount > 0) {
            (, Currency pair,,,,,) = hook.config(id);
            hook.debitKickback(id, amount, address(this));
            liabilities[Currency.unwrap(pair)] += amount;
        }
        if (carry > 0) emit RolloverApplied(id, epochId, carry);
        emit KickbackFunded(id, epochId, amount);
    }

    function postRoot(PoolId id, uint64 epochId, bytes32 root, bytes32 manifestHash) external {
        if (msg.sender != publisher) revert NotPublisher();
        Epoch storage e = epochs[id][epochId];
        if (e.funded == 0 || e.cancelled || e.postedAt != 0) revert BadEpoch();
        if (block.timestamp < e.end) revert BadEpoch();
        if (root == bytes32(0) || manifestHash == bytes32(0)) revert BadEpoch();
        e.root = root;
        e.manifestHash = manifestHash;
        e.postedAt = uint64(block.timestamp);
        emit RootPosted(id, epochId, root, manifestHash);
    }

    function cancel(PoolId id, uint64 epochId) external nonReentrant {
        if (msg.sender != roles.guardian()) revert NotGuardian();
        Epoch storage e = epochs[id][epochId];
        if (e.funded == 0 || e.cancelled || roundClosed[id][epochId]) revert BadEpoch();
        if (
            e.claimed != 0 || paidOut[id][epochId] != 0 || claimableEpoch[id][epochId] != 0
                || rolloverEpoch[id][epochId] != 0 || gasPaidEpoch[id][epochId] != 0
        ) revert BadEpoch();
        if (e.postedAt != 0 && block.timestamp >= uint256(e.postedAt) + C.REVIEW_WINDOW) revert ReviewClosed();
        e.cancelled = true;
        uint256 amount = e.funded;
        (, Currency pair,,,,,) = hook.config(id);
        address token = Currency.unwrap(pair);
        liabilities[token] -= amount;
        IERC20(token).forceApprove(address(hook), amount);
        hook.restoreKickback(id, amount);
        emit KickbackCancelled(id, epochId, amount);
    }

    function claim(PoolId id, uint64 epochId, address account, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
    {
        _requireOpen(id, epochId);
        if (claimed[id][epochId][account]) revert AlreadyClaimed();
        if (isSkipped(id, account)) revert Excluded();
        _verify(id, epochId, account, amount, proof);
        if (amount == 0 || amount > holderBudget(id, epochId) || amount > type(uint128).max) revert Cap();
        if (amount < dustThreshold) revert Dust();
        claimed[id][epochId][account] = true;
        address token = _pairToken(id);
        SendResult result = _send(token, account, amount);
        if (result == SendResult.Ok) {
            epochs[id][epochId].claimed += uint128(amount);
            liabilities[token] -= amount;
            emit KickbackClaimed(id, epochId, account, amount);
        } else if (result == SendResult.Failed) {
            claimable[id][epochId][account] += amount;
            claimableEpoch[id][epochId] += amount;
            emit ClaimableCredited(id, epochId, account, amount);
        } else {
            revert TransferFailed();
        }
    }

    /// @notice Keeper push of one batch of merkle leaves. Length is at most `MAX_BATCH`.
    ///         A reverting receiver is credited and the loop continues. The keeper is then
    ///         reimbursed from this round, up to the gas cap and the tokens still in the round.
    function push(
        PoolId id,
        uint64 epochId,
        address[] calldata accounts,
        uint256[] calldata amounts,
        bytes32[][] calldata proofs
    ) external nonReentrant returns (uint256 gasReimbursed) {
        if (msg.sender != keeper || keeper == address(0)) revert NotKeeper();
        uint256 n = accounts.length;
        if (n == 0 || n > MAX_BATCH || n != amounts.length || n != proofs.length) revert Batch();
        _requireOpen(id, epochId);
        uint256 gasStart = gasleft();
        address token = _pairToken(id);
        for (uint256 i; i < n; ++i) {
            _pushOne(id, epochId, token, accounts[i], amounts[i], proofs[i]);
        }
        gasReimbursed = _reimburse(id, epochId, token, gasStart);
    }

    /// @notice Holder pull of a push that reverted. Works after the round is closed.
    ///         A still-reverting token reverts this call and leaves the credit in place.
    function claimFailed(PoolId id, uint64 epochId) external nonReentrant returns (uint256 amount) {
        amount = claimable[id][epochId][msg.sender];
        if (amount == 0) revert Nothing();
        address token = _pairToken(id);
        claimable[id][epochId][msg.sender] = 0;
        claimableEpoch[id][epochId] -= amount;
        paidOut[id][epochId] += amount;
        liabilities[token] -= amount;
        if (_send(token, msg.sender, amount) != SendResult.Ok) revert TransferFailed();
        emit FailedPull(id, epochId, msg.sender, amount);
    }

    /// @notice Classifies whatever is left in the round as rollover and closes it.
    function seal(PoolId id, uint64 epochId) external nonReentrant {
        if (msg.sender != keeper || keeper == address(0)) revert NotKeeper();
        _requireOpen(id, epochId);
        Round memory r = roundOf(id, epochId);
        if (r.pending > 0) _rollover(id, epochId, r.pending);
        roundClosed[id][epochId] = true;
        emit RoundSealed(id, epochId, r.pending);
    }

    function sweep(PoolId, uint64) external pure {
        revert SweepNotEnabled();
    }

    function roundOf(PoolId id, uint64 epochId) public view returns (Round memory r) {
        Epoch storage e = epochs[id][epochId];
        r.funded = e.funded;
        r.pushed = uint256(e.claimed) + paidOut[id][epochId];
        r.claimable = claimableEpoch[id][epochId];
        r.rollover = rolloverEpoch[id][epochId];
        r.gasPaid = gasPaidEpoch[id][epochId];
        r.pending = r.funded - r.pushed - r.claimable - r.rollover - r.gasPaid;
    }

    /// @notice `pushed + claimable + rollover + gasPaid + pending == funded`, and gas stays inside 2%.
    function conserves(PoolId id, uint64 epochId) public view returns (bool) {
        if (epochs[id][epochId].funded == 0) return true;
        Round memory r = roundOf(id, epochId);
        return r.pushed + r.claimable + r.rollover + r.gasPaid + r.pending == r.funded
            && r.gasPaid <= r.funded * MAX_GAS_CAP_BPS / BPS;
    }

    /// @notice After `seal`, the three holder buckets equal the pot net of keeper gas.
    function holderSettled(PoolId id, uint64 epochId) public view returns (bool) {
        if (!roundClosed[id][epochId]) return false;
        Round memory r = roundOf(id, epochId);
        return r.pending == 0 && r.pushed + r.claimable + r.rollover == r.funded - r.gasPaid;
    }

    /// @notice Tokens still payable to holders. The unpaid gas cap is held back until `seal`.
    function holderBudget(PoolId id, uint64 epochId) public view returns (uint256) {
        Round memory r = roundOf(id, epochId);
        uint256 cap = r.funded * gasCapBps / BPS;
        uint256 held = r.gasPaid >= cap ? 0 : cap - r.gasPaid;
        uint256 used = r.pushed + r.claimable + r.rollover + r.gasPaid;
        if (used + held >= r.funded) return 0;
        return r.funded - used - held;
    }

    function teamWallet(PoolId id) public view returns (address) {
        (address coin,,,,,,) = hook.config(id);
        return LaunchToken(coin).teamWallet();
    }

    function isExcluded(address account) public view returns (bool) {
        return account == address(0) || account == C.DEAD || account == address(hook) || account == address(this)
            || account == poolManager || account == locker || account == vault || account == buybackExecutor;
    }

    /// @notice Team wallets are always skipped. Contracts are skipped unless the timelock allowlisted them.
    ///         The pool manager, locker, hook, and the other protocol contracts are skipped too.
    function isSkipped(PoolId id, address account) public view returns (bool) {
        if (isExcluded(account)) return true;
        address team = teamWallet(id);
        if (team != address(0) && account == team) return true;
        if (account.code.length > 0 && !allowlisted[account]) return true;
        return false;
    }

    function _pushOne(
        PoolId id,
        uint64 epochId,
        address token,
        address account,
        uint256 amount,
        bytes32[] calldata proof
    ) internal {
        if (amount == 0) revert Cap();
        if (claimed[id][epochId][account]) revert AlreadyClaimed();
        _verify(id, epochId, account, amount, proof);
        if (amount > holderBudget(id, epochId)) revert Cap();
        claimed[id][epochId][account] = true;
        if (isSkipped(id, account) || amount < dustThreshold) {
            _rollover(id, epochId, amount);
            emit Rolled(id, epochId, account, amount);
            return;
        }
        SendResult result = _send(token, account, amount);
        if (result == SendResult.Ok) {
            paidOut[id][epochId] += amount;
            liabilities[token] -= amount;
            emit Pushed(id, epochId, account, amount);
        } else if (result == SendResult.Failed) {
            claimable[id][epochId][account] += amount;
            claimableEpoch[id][epochId] += amount;
            emit ClaimableCredited(id, epochId, account, amount);
        } else {
            revert TransferFailed();
        }
    }

    function _reimburse(PoolId id, uint64 epochId, address token, uint256 gasStart) internal returns (uint256 payment) {
        uint256 funded = epochs[id][epochId].funded;
        uint256 cap = funded * gasCapBps / BPS;
        uint256 already = gasPaidEpoch[id][epochId];
        if (already >= cap || tx.gasprice == 0) return 0;
        uint256 room = cap - already;
        Round memory r = roundOf(id, epochId);
        if (r.pending == 0) return 0;
        uint256 usedGas = gasStart - gasleft() + GAS_OVERHEAD;
        uint256 price = tx.gasprice;
        uint256 cost = usedGas > type(uint256).max / price ? type(uint256).max : usedGas * price;
        payment = cost;
        if (payment > room) payment = room;
        if (payment > r.pending) payment = r.pending;
        if (payment == 0) return 0;
        if (_send(token, msg.sender, payment) != SendResult.Ok) return 0;
        gasPaidEpoch[id][epochId] = already + payment;
        liabilities[token] -= payment;
        emit GasReimbursed(id, epochId, msg.sender, payment);
    }

    function _rollover(PoolId id, uint64 epochId, uint256 amount) internal {
        rolloverEpoch[id][epochId] += amount;
        poolCarry[id] += amount;
    }

    function _requireOpen(PoolId id, uint64 epochId) internal view {
        Epoch storage e = epochs[id][epochId];
        if (e.funded == 0 || e.cancelled || e.postedAt == 0) revert BadEpoch();
        if (roundClosed[id][epochId]) revert Sealed();
        if (block.timestamp < uint256(e.postedAt) + C.REVIEW_WINDOW) revert ReviewOpen();
    }

    function _verify(PoolId id, uint64 epochId, address account, uint256 amount, bytes32[] calldata proof)
        internal
        view
    {
        bytes32 leaf = _leaf(id, epochId, account, amount);
        if (!MerkleProof.verifyCalldata(proof, epochs[id][epochId].root, leaf)) revert BadProof();
    }

    function _leaf(PoolId id, uint64 epochId, address account, uint256 amount) internal view returns (bytes32) {
        (address coin, Currency pair,,,,,) = hook.config(id);
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(block.chainid, address(this), coin, Currency.unwrap(pair), epochId, account, amount)
                )
            )
        );
    }

    function _pairToken(PoolId id) internal view returns (address) {
        (, Currency pair,,,,,) = hook.config(id);
        return Currency.unwrap(pair);
    }

    /// @dev Success is an exact balance decrease. A revert that moves nothing is `Failed`.
    ///      Any other movement stops the call so the round cannot lose tokens.
    function _send(address token, address to, uint256 amount) internal returns (SendResult) {
        uint256 beforeBal = IERC20(token).balanceOf(address(this));
        bool reported = _tryTransfer(token, to, amount);
        uint256 afterBal = IERC20(token).balanceOf(address(this));
        if (afterBal == beforeBal) return SendResult.Failed;
        if (reported && beforeBal == afterBal + amount) return SendResult.Ok;
        return SendResult.Moved;
    }

    function _tryTransfer(address token, address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory data) = token.call{gas: TRANSFER_GAS}(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok) return false;
        if (data.length == 0) return token.code.length > 0;
        if (data.length < 32) return false;
        uint256 word;
        assembly ("memory-safe") {
            word := mload(add(data, 32))
        }
        return word == 1;
    }

    function _accountHour(uint256 amount) internal {
        if (block.timestamp >= hourStart + 1 hours) {
            hourStart = block.timestamp;
            fundedThisHour = 0;
        }
        if (fundedThisHour + amount > hourlyCap) revert Cap();
        fundedThisHour += amount;
    }
}
