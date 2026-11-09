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

/// @notice Hourly Kickback rounds. Epochs are timestamp windows, never block ranges.
///         The publisher can fund and post a root. Only the guardian role can cancel, and only
///         during the review hour. Cancel returns the pair tokens to the pool's kickback pot.
contract KickbackDistributor {
    using SafeERC20 for IERC20;
    error NotPublisher();
    error NotGuardian();
    error NotTimelock();
    error NotInitializer();
    error BadEpoch();
    error Cap();
    error ReviewOpen();
    error ReviewClosed();
    error Excluded();
    error BadProof();
    error AlreadyClaimed();
    error SweepNotEnabled();
    error NotKeeper();
    error NotLauncher();
    error NotAdmin();
    error MissingKeeper();

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

    event KickbackFunded(PoolId indexed poolId, uint64 indexed epoch, uint256 amount);
    event RootPosted(PoolId indexed poolId, uint64 indexed epoch, bytes32 root, bytes32 manifestHash);
    event KickbackCancelled(PoolId indexed poolId, uint64 indexed epoch, uint256 refunded);
    event KickbackClaimed(PoolId indexed poolId, uint64 indexed epoch, address account, uint256 amount);
    event KickbackPushed(PoolId indexed poolId, uint64 indexed epoch, address indexed account, uint256 amount);
    event KickbackRolled(PoolId indexed poolId, uint64 indexed epoch, address indexed account, uint256 amount);
    event KickbackFallback(PoolId indexed poolId, uint64 indexed epoch, address indexed account, uint256 amount);
    event KeeperReimbursed(PoolId indexed poolId, uint64 indexed epoch, address indexed keeper, uint256 amount);
    event TeamNoted(PoolId indexed poolId, address indexed team);

    SeedixRoles public immutable roles;
    address public immutable initializer;
    LaunchHook public hook;
    address public publisher;
    address public poolManager;
    address public locker;
    address public vault;
    address public buybackExecutor;
    address public launcher;
    address public keeper;

    /// @dev Amounts below this stay in the contract and are added to the next epoch.
    uint256 public constant DUST = 1_000;
    /// @dev Mainnet gas reimbursement cap, in bps of the tokens actually transferred.
    uint256 public constant GAS_CAP_BPS = 200;

    uint256 public roundCap;
    uint256 public hourlyCap;
    uint256 public hourStart;
    uint256 public fundedThisHour;

    mapping(PoolId => mapping(uint64 => Epoch)) public epochs;
    mapping(PoolId => uint64) public nextEpoch;
    mapping(PoolId => uint64) public lastEnd;
    mapping(PoolId => mapping(uint64 => mapping(address => bool))) public claimed;
    mapping(PoolId => mapping(uint64 => mapping(address => uint256))) public fallbackOf;
    mapping(PoolId => address) public teamOf;
    mapping(PoolId => bool) public teamSet;
    mapping(PoolId => uint256) public rollover;
    mapping(address => uint256) public liabilities;

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

    /// @notice One-shot. The launcher records each pool's team wallet at launch.
    function setLauncher(address next) external {
        if (msg.sender != initializer || launcher != address(0) || next == address(0)) revert NotInitializer();
        launcher = next;
    }

    function noteTeam(PoolId id, address team) external {
        if (msg.sender != launcher) revert NotLauncher();
        if (teamSet[id]) revert BadEpoch();
        teamSet[id] = true;
        teamOf[id] = team;
        emit TeamNoted(id, team);
    }

    /// @notice Deployer sets the first keeper once. Later changes go through `setKeeper`.
    function setInitialKeeper(address next) external {
        if (msg.sender != initializer || keeper != address(0) || next == address(0)) revert NotInitializer();
        keeper = next;
    }

    /// @notice Admin can grant or revoke the keeper. The zero address revokes it.
    ///         Mainnet must timelock the grant. This testnet build applies it immediately.
    function setKeeper(address next) external {
        if (msg.sender != roles.admin()) revert NotAdmin();
        keeper = next;
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

    function fund(PoolId id, uint128 amount) external returns (uint64 epochId) {
        if (msg.sender != publisher) revert NotPublisher();
        if (amount == 0 || amount > roundCap) revert Cap();
        _accountHour(amount);
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

        uint256 extra = rollover[id];
        rollover[id] = 0;
        uint256 total = uint256(amount) + extra;
        if (total > type(uint128).max) revert Cap();

        epochId = ++nextEpoch[id];
        epochs[id][epochId] = Epoch({
            funded: uint128(total),
            claimed: 0,
            start: start,
            end: end,
            postedAt: 0,
            root: bytes32(0),
            manifestHash: bytes32(0),
            cancelled: false
        });
        lastEnd[id] = end;

        (, Currency pair,,,,,) = hook.config(id);
        hook.debitKickback(id, amount, address(this));
        liabilities[Currency.unwrap(pair)] += amount;
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

    function cancel(PoolId id, uint64 epochId) external {
        if (msg.sender != roles.guardian()) revert NotGuardian();
        Epoch storage e = epochs[id][epochId];
        if (e.funded == 0 || e.cancelled) revert BadEpoch();
        if (e.postedAt != 0 && block.timestamp >= uint256(e.postedAt) + C.REVIEW_WINDOW) revert ReviewClosed();
        if (e.claimed != 0) revert BadEpoch();
        e.cancelled = true;
        uint256 amount = e.funded;
        (, Currency pair,,,,,) = hook.config(id);
        address token = Currency.unwrap(pair);
        liabilities[token] -= amount;
        IERC20(token).forceApprove(address(hook), amount);
        hook.restoreKickback(id, amount);
        emit KickbackCancelled(id, epochId, amount);
    }

    function claim(PoolId id, uint64 epochId, address account, uint256 amount, bytes32[] calldata proof) external {
        Epoch storage e = epochs[id][epochId];
        if (e.funded == 0 || e.cancelled || e.postedAt == 0) revert BadEpoch();
        if (block.timestamp < uint256(e.postedAt) + C.REVIEW_WINDOW) revert ReviewOpen();
        if (claimed[id][epochId][account]) revert AlreadyClaimed();
        if (isExcluded(account) || account == teamOf[id]) revert Excluded();
        (address coin, Currency pair,,,,,) = hook.config(id);
        bytes32 leaf = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(block.chainid, address(this), coin, Currency.unwrap(pair), epochId, account, amount)
                )
            )
        );
        if (!MerkleProof.verifyCalldata(proof, e.root, leaf)) revert BadProof();
        if (uint256(e.claimed) + amount > e.funded) revert Cap();
        claimed[id][epochId][account] = true;
        e.claimed += uint128(amount);
        address token = Currency.unwrap(pair);
        liabilities[token] -= amount;
        IERC20(token).safeTransfer(account, amount);
        emit KickbackClaimed(id, epochId, account, amount);
    }

    function sweep(PoolId, uint64) external pure {
        revert SweepNotEnabled();
    }

    /// @notice Keeper pays a posted epoch. Dust, the team wallet, contracts, and protocol
    ///         addresses roll into the next round. A transfer that fails stays claimable.
    function push(
        PoolId id,
        uint64 epochId,
        address[] calldata accounts,
        uint256[] calldata amounts,
        bytes32[][] calldata proofs
    ) external returns (uint256 paid, uint256 rolled, uint256 failed) {
        if (msg.sender != keeper || keeper == address(0)) revert NotKeeper();
        uint256 n = accounts.length;
        if (n == 0 || n != amounts.length || n != proofs.length) revert BadEpoch();
        Epoch storage e = epochs[id][epochId];
        if (e.funded == 0 || e.cancelled || e.postedAt == 0) revert BadEpoch();
        if (block.timestamp < uint256(e.postedAt) + C.REVIEW_WINDOW) revert ReviewOpen();

        uint256 gasStart = gasleft();
        (address coin, Currency pair,,,,,) = hook.config(id);
        address token = Currency.unwrap(pair);
        address team = teamOf[id];
        for (uint256 i; i < n; ++i) {
            address account = accounts[i];
            uint256 amount = amounts[i];
            if (amount == 0 || claimed[id][epochId][account]) revert AlreadyClaimed();
            if (uint256(e.claimed) + amount > e.funded) revert Cap();
            bytes32 leaf = keccak256(
                bytes.concat(keccak256(abi.encode(block.chainid, address(this), coin, token, epochId, account, amount)))
            );
            if (!MerkleProof.verifyCalldata(proofs[i], e.root, leaf)) revert BadProof();

            claimed[id][epochId][account] = true;
            e.claimed += uint128(amount);
            if (amount < DUST || account == team || isExcluded(account) || account.code.length > 0) {
                rollover[id] += amount;
                rolled += amount;
                emit KickbackRolled(id, epochId, account, amount);
                continue;
            }
            if (!_tryPay(token, account, amount)) {
                fallbackOf[id][epochId][account] = amount;
                failed += amount;
                emit KickbackFallback(id, epochId, account, amount);
                continue;
            }
            liabilities[token] -= amount;
            paid += amount;
            emit KickbackPushed(id, epochId, account, amount);
        }
        _reimburse(id, epochId, token, e, paid, gasStart);
    }

    /// @notice Collect a push that the token refused. Pays at most once.
    function claimFallback(PoolId id, uint64 epochId, address account) external {
        uint256 amount = fallbackOf[id][epochId][account];
        if (amount == 0) revert BadEpoch();
        if (isExcluded(account) || account == teamOf[id] || account.code.length > 0) revert Excluded();
        (, Currency pair,,,,,) = hook.config(id);
        address token = Currency.unwrap(pair);
        fallbackOf[id][epochId][account] = 0;
        liabilities[token] -= amount;
        if (!_tryPay(token, account, amount)) revert BadEpoch();
        emit KickbackClaimed(id, epochId, account, amount);
    }

    function isExcluded(address account) public view returns (bool) {
        return account == address(0) || account == C.DEAD || account == address(hook) || account == address(this)
            || account == poolManager || account == locker || account == vault || account == buybackExecutor;
    }

    function _reimburse(PoolId id, uint64 epochId, address token, Epoch storage e, uint256 paid, uint256 gasStart)
        internal
    {
        if (block.chainid != 99901 || paid == 0) return;
        uint256 used = gasStart - gasleft() + 45_000;
        uint256 cost = used * tx.gasprice;
        uint256 cap = paid * GAS_CAP_BPS / 10_000;
        uint256 reimburse = cost < cap ? cost : cap;
        uint256 remaining = uint256(e.funded) - uint256(e.claimed);
        if (reimburse > remaining) reimburse = remaining;
        if (reimburse == 0) return;
        e.claimed += uint128(reimburse);
        liabilities[token] -= reimburse;
        IERC20(token).safeTransfer(keeper, reimburse);
        emit KeeperReimbursed(id, epochId, keeper, reimburse);
    }

    /// @dev A revert or an explicit `false` is a failed payment and stays claimable.
    ///      An empty return is success, matching SafeERC20, so that transfer is not paid again.
    function _tryPay(address token, address to, uint256 amount) internal returns (bool) {
        (bool ok, bytes memory data) = token.call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (!ok) return false;
        if (data.length == 0) return true;
        if (data.length < 32) revert BadEpoch();
        return abi.decode(data, (bool));
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
