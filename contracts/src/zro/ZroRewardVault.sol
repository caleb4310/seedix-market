// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {LaunchHook} from "../hook/LaunchHook.sol";
import {IZroPayout} from "./IZroPayout.sol";
import {ZroWeightTracker} from "./ZroWeightTracker.sol";

/// @notice Pull-based ZRO rewards. One round is one hour. The swapper funds it after the hour closes.
///         A holder calls `claim` for their own weight. Nothing iterates the holder set.
///
///         `payout = floor(weight * funded / totalWeight)`.
///         Rounding dust stays in the vault. When the last unit of weight is claimed, that dust is
///         added to `pendingDust` and the next `fund` pays it out. If a round has zero weight, the
///         whole deposit becomes `pendingDust` immediately, so it is not locked.
///         `totalClaimed <= totalFunded` always. ZRO that has not been claimed stays in this contract.
///
///         Phase 2 sets `payoutModule` and holders call `claimRemote`. The holder pays the LayerZero
///         fee with `msg.value`. This vault does not have to be redeployed for that.
///         `owner` and `delegate` are constructor arguments. They are the multisig, not a hardcoded EOA.
contract ZroRewardVault {
    using SafeERC20 for IERC20;

    error NotOwner();
    error NotTimelock();
    error NotSwapper();
    error ZeroAddress();
    error Paused();
    error Locked();
    error Early();
    error AlreadyFunded();
    error Nothing();
    error AlreadyClaimed();
    error NoModule();
    error Overflow();
    error TransferFailed();

    uint256 public constant ROUND_SECONDS = 1 hours;

    struct Round {
        uint128 funded;
        uint128 claimed;
        uint256 claimedWeight;
        uint256 totalWeight;
        uint64 start;
        uint64 end;
        bool opened;
    }

    IERC20 public immutable zro;
    LaunchHook public immutable hook;
    ZroWeightTracker public immutable tracker;
    address public immutable initializer;
    address public owner;
    address public delegate;
    address public timelock;
    address public swapper;
    address public payoutModule;
    bool public paused;

    uint256 public totalFunded;
    uint256 public totalClaimed;
    uint256 public liabilities;
    uint256 public pendingDust;
    uint256 private _entered;

    mapping(bytes32 id => Round) public rounds;
    mapping(bytes32 id => mapping(address account => bool)) public claimed;

    event Funded(PoolId indexed poolId, uint64 indexed epoch, uint256 amount, uint256 weight, uint256 dustIn);
    event Claimed(PoolId indexed poolId, uint64 indexed epoch, address indexed account, uint256 amount);
    event DustRecycled(bytes32 indexed roundId, uint256 amount);
    event PausedSet(bool paused);
    event OwnerSet(address indexed previous, address indexed next);
    event DelegateSet(address indexed previous, address indexed next);
    event PayoutModuleSet(address indexed previous, address indexed next);
    event SwapperSet(address indexed swapper);

    modifier nonReentrant() {
        if (_entered != 0) revert Locked();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(
        address owner_,
        address delegate_,
        address timelock_,
        address initializer_,
        IERC20 zro_,
        LaunchHook hook_,
        ZroWeightTracker tracker_
    ) {
        if (
            owner_ == address(0) || delegate_ == address(0) || timelock_ == address(0) || initializer_ == address(0)
                || address(zro_) == address(0) || address(hook_) == address(0) || address(tracker_) == address(0)
        ) revert ZeroAddress();
        owner = owner_;
        delegate = delegate_;
        timelock = timelock_;
        initializer = initializer_;
        zro = zro_;
        hook = hook_;
        tracker = tracker_;
    }

    /// @notice One shot. The deploy key or the owner/timelock can set it. After that it stays put,
    ///         so phase 2 does not redeploy the vault to change who swaps.
    function setSwapper(address next) external {
        if (swapper != address(0) || next == address(0)) revert NotOwner();
        if (msg.sender != initializer && !_admin(msg.sender)) revert NotOwner();
        swapper = next;
        emit SwapperSet(next);
    }

    function setOwner(address next) external {
        if (msg.sender != timelock || next == address(0)) revert NotTimelock();
        emit OwnerSet(owner, next);
        owner = next;
    }

    function setDelegate(address next) external {
        if (!_admin(msg.sender) || next == address(0)) revert NotOwner();
        emit DelegateSet(delegate, next);
        delegate = next;
    }

    /// @notice Phase 2 plugs an OFT sender here. The zero address keeps claims as local transfers.
    function setPayoutModule(address next) external {
        if (!_admin(msg.sender)) revert NotOwner();
        emit PayoutModuleSet(payoutModule, next);
        payoutModule = next;
    }

    function pause() external {
        if (msg.sender != owner) revert NotOwner();
        paused = true;
        emit PausedSet(true);
    }

    function unpause() external {
        if (msg.sender != owner) revert NotOwner();
        paused = false;
        emit PausedSet(false);
    }

    /// @notice Swapper deposits ZRO for the closed hour `epoch`. Weight is read from the tracker.
    function fund(PoolId poolId, uint64 epoch, uint256 amount) external nonReentrant {
        if (msg.sender != swapper) revert NotSwapper();
        if (paused) revert Paused();
        if (amount == 0) revert Nothing();
        (uint64 start, uint64 end) = _window(epoch);
        if (block.timestamp < end) revert Early();
        bytes32 id = _id(poolId, epoch);
        Round storage round = rounds[id];
        if (round.opened) revert AlreadyFunded();

        zro.safeTransferFrom(msg.sender, address(this), amount);
        totalFunded += amount;

        (address coin,,,,,,) = hook.config(poolId);
        uint256 weight = tracker.totalWeight(coin, start, end);
        uint256 dustIn = pendingDust;
        pendingDust = 0;
        uint256 pot = amount + dustIn;
        if (weight == 0) {
            pendingDust = pot;
            round.opened = true;
            round.start = start;
            round.end = end;
            emit Funded(poolId, epoch, amount, 0, dustIn);
            return;
        }
        if (pot > type(uint128).max) revert Overflow();
        round.opened = true;
        round.funded = uint128(pot);
        round.totalWeight = weight;
        round.start = start;
        round.end = end;
        liabilities += pot;
        emit Funded(poolId, epoch, amount, weight, dustIn);
    }

    function claim(PoolId poolId, uint64 epoch) external nonReentrant returns (uint256 amount) {
        amount = _account(poolId, epoch, msg.sender);
        if (amount == 0) return 0;
        _payLocal(msg.sender, amount);
        emit Claimed(poolId, epoch, msg.sender, amount);
    }

    /// @notice LayerZero native fee for sending `amount` of ZRO to `to` on `dstEid`.
    function quoteRemote(address to, uint256 amount, uint32 dstEid, bytes calldata options)
        external
        view
        returns (uint256 nativeFee)
    {
        if (payoutModule == address(0)) revert NoModule();
        nativeFee = IZroPayout(payoutModule).quote(address(zro), to, amount, dstEid, options);
    }

    /// @notice Phase 2. Same accounting as `claim`. The module sends ZRO through the OFT.
    ///         `msg.value` covers the LayerZero fee. The module refunds anything above the quote.
    function claimRemote(PoolId poolId, uint64 epoch, uint32 dstEid, bytes calldata options)
        external
        payable
        nonReentrant
        returns (uint256 amount)
    {
        if (payoutModule == address(0)) revert NoModule();
        amount = _account(poolId, epoch, msg.sender);
        if (amount == 0) {
            if (msg.value > 0) revert Nothing();
            return 0;
        }
        zro.forceApprove(payoutModule, amount);
        IZroPayout(payoutModule).payout{value: msg.value}(address(zro), msg.sender, amount, dstEid, options);
        if (zro.allowance(address(this), payoutModule) != 0) zro.forceApprove(payoutModule, 0);
        emit Claimed(poolId, epoch, msg.sender, amount);
    }

    function roundId(PoolId poolId, uint64 epoch) external pure returns (bytes32) {
        return _id(poolId, epoch);
    }

    function _account(PoolId poolId, uint64 epoch, address account) internal returns (uint256 amount) {
        if (paused) revert Paused();
        bytes32 id = _id(poolId, epoch);
        Round storage round = rounds[id];
        if (!round.opened || round.totalWeight == 0) revert Nothing();
        if (claimed[id][account]) revert AlreadyClaimed();
        (address coin,,,,,,) = hook.config(poolId);
        uint256 w = tracker.weight(coin, account, round.start, round.end);
        claimed[id][account] = true;
        if (w == 0) return 0;
        amount = w * round.funded / round.totalWeight;
        round.claimedWeight += w;
        if (amount > 0) {
            if (amount > round.funded - round.claimed) revert Overflow();
            round.claimed += uint128(amount);
            liabilities -= amount;
            totalClaimed += amount;
        }
        _recycle(id, round);
    }

    function _recycle(bytes32 id, Round storage round) internal {
        if (round.claimedWeight != round.totalWeight) return;
        uint256 dust = uint256(round.funded) - round.claimed;
        if (dust == 0) return;
        round.claimed = round.funded;
        liabilities -= dust;
        pendingDust += dust;
        emit DustRecycled(id, dust);
    }

    function _payLocal(address to, uint256 amount) internal {
        uint256 beforeBal = zro.balanceOf(address(this));
        zro.safeTransfer(to, amount);
        if (zro.balanceOf(address(this)) != beforeBal - amount) revert TransferFailed();
    }

    function _admin(address account) internal view returns (bool) {
        return account == owner || account == timelock;
    }

    function _window(uint64 epoch) internal pure returns (uint64 start, uint64 end) {
        start = uint64(uint256(epoch) * ROUND_SECONDS);
        end = start + uint64(ROUND_SECONDS);
    }

    function _id(PoolId poolId, uint64 epoch) internal pure returns (bytes32) {
        return keccak256(abi.encode(poolId, epoch));
    }
}
