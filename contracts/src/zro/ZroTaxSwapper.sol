// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SeedixConstants as C} from "../libraries/SeedixConstants.sol";
import {OracleLib} from "../libraries/OracleLib.sol";
import {TwapGuard} from "../libraries/TwapGuard.sol";
import {LaunchHook} from "../hook/LaunchHook.sol";
import {ZroRewardVault} from "./ZroRewardVault.sol";
import {ZroRoundSplit} from "./ZroRoundSplit.sol";

/// @notice Swaps the creator-tax pot to ZRO outside the hook's swap callback.
///         The keeper calls `harvest` in its own transaction. The hook only escrows the tax.
///         A call that arrives while the hook is inside a user swap reverts on the hook lock.
///
///         Slippage: spot must sit inside the TWAP band. The keeper's `minOut` must lie within
///         `maxDeviationBps` of the TWAP quote and cannot be below the TWAP floor (1% worse than
///         the quote). The swap's price limit is the far side of that band, so the fill cannot
///         walk through a sandwich.
contract ZroTaxSwapper is IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    error NotOwner();
    error NotTimelock();
    error NotKeeper();
    error ZeroAddress();
    error Paused();
    error Locked();
    error BadPool();
    error Slippage();
    error Nothing();
    error NotPoolManager();
    error TooLittleReceived();

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_DEVIATION_BPS = 500;
    uint256 public constant ROUND_SECONDS = 1 hours;
    /// @dev Keep this equal to `ZroFeeMath.MAX_HARVEST_ROUNDS`.
    uint256 public constant MAX_ROUNDS = 8;

    LaunchHook public immutable hook;
    ZroRewardVault public immutable vault;
    IPoolManager public immutable poolManager;
    address public immutable weth;
    address public immutable zro;
    address public owner;
    address public timelock;
    address public keeper;
    address public protocolRecipient;
    uint256 public maxDeviationBps = 100;
    bool public paused;
    bool public poolSet;
    PoolKey public poolKey;
    OracleLib.State internal _oracle;
    /// @notice Next closed hour to settle. Zero means "start at the pool's launch hour".
    mapping(PoolId => uint64) public nextHarvestEpoch;
    uint256 private _entered;

    event PoolRegistered(PoolId indexed poolId);
    event Harvested(PoolId indexed poolId, uint64 indexed epoch, uint256 pairIn, uint256 zroOut, uint256 protocolOut);
    event PausedSet(bool paused);
    event KeeperSet(address indexed keeper);
    event OwnerSet(address indexed previous, address indexed next);
    event DeviationSet(uint256 bps);

    modifier nonReentrant() {
        if (_entered != 0) revert Locked();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(
        address owner_,
        address timelock_,
        address protocolRecipient_,
        LaunchHook hook_,
        ZroRewardVault vault_,
        address weth_,
        address zro_
    ) {
        if (
            owner_ == address(0) || timelock_ == address(0) || protocolRecipient_ == address(0)
                || address(hook_) == address(0) || address(vault_) == address(0) || weth_ == address(0)
                || zro_ == address(0)
        ) revert ZeroAddress();
        owner = owner_;
        timelock = timelock_;
        protocolRecipient = protocolRecipient_;
        hook = hook_;
        vault = vault_;
        poolManager = hook_.poolManager();
        weth = weth_;
        zro = zro_;
    }

    function setOwner(address next) external {
        if (msg.sender != owner || next == address(0)) revert NotOwner();
        emit OwnerSet(owner, next);
        owner = next;
    }

    function setKeeper(address next) external {
        if (!_admin(msg.sender)) revert NotOwner();
        keeper = next;
        emit KeeperSet(next);
    }

    function setProtocolRecipient(address next) external {
        if (!_admin(msg.sender) || next == address(0)) revert NotOwner();
        protocolRecipient = next;
    }

    function setMaxDeviationBps(uint256 next) external {
        if (!_admin(msg.sender) || next == 0 || next > MAX_DEVIATION_BPS) revert NotOwner();
        maxDeviationBps = next;
        emit DeviationSet(next);
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

    /// @notice The ZRO/WETH pool is hookless, so this swap is not the Seedix hook's swap path.
    function registerPool(PoolKey calldata key) external {
        if (!_admin(msg.sender) || poolSet) revert NotOwner();
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        bool pair = (c0 == zro && c1 == weth) || (c0 == weth && c1 == zro);
        if (!pair || address(key.hooks) != address(0)) revert BadPool();
        (uint160 sqrtP, int24 tick,,) = poolManager.getSlot0(key.toId());
        if (sqrtP == 0) revert BadPool();
        poolKey = key;
        poolSet = true;
        OracleLib.init(_oracle, uint32(block.timestamp), tick);
        emit PoolRegistered(key.toId());
    }

    /// @notice Records the pre-swap tick. The harvest TWAP needs 30 minutes of these observations.
    function poke() external {
        if (!poolSet) revert BadPool();
        (, int24 tick,,) = poolManager.getSlot0(poolKey.toId());
        OracleLib.onSwap(_oracle, uint32(block.timestamp), tick);
    }

    /// @dev View of the TWAP quote and the floor the keeper's minOut is checked against.
    function quote(uint256 amountIn)
        external
        view
        returns (uint256 twapOut, uint256 floor, uint256 lower, uint256 upper)
    {
        (int24 twap, bool zeroForOne) = _twap();
        twapOut = _rawOut(amountIn, twap, zeroForOne);
        floor = TwapGuard.minOut(amountIn, twap, zeroForOne);
        (lower, upper) = _band(twapOut, floor);
    }

    /// @notice Swap the pair-token tax accrued in the next closed hours, at most `MAX_ROUNDS` of them.
    ///         ZRO out is split by each hour's accrued holder tax. The remainder of that split goes to
    ///         the last hour in the batch. Call again to continue through hours this call did not reach.
    function harvest(PoolId poolId, uint256 minOut) external nonReentrant returns (uint256 zroOut) {
        if (keeper == address(0) || msg.sender != keeper) revert NotKeeper();
        if (paused || !poolSet) revert Paused();
        (, Currency pair,,,,,) = hook.config(poolId);
        if (Currency.unwrap(pair) != weth) revert BadPool();

        (uint64 from, uint64 to, uint64 lastClosed) = _harvestSpan(poolId);
        uint256 span = uint256(to - from) + 1;
        uint64[] memory epochs = new uint64[](span);
        uint256[] memory weights = new uint256[](span);
        for (uint256 i; i < span; ++i) {
            uint64 epoch = from + uint64(i);
            epochs[i] = epoch;
            weights[i] = hook.zroHolderEpoch(poolId, epoch);
        }

        uint256 holderIn = 0;
        for (uint256 i; i < span; ++i) {
            holderIn += weights[i];
        }
        if (holderIn == 0 && _protocolInSpan(poolId, epochs) == 0) {
            nextHarvestEpoch[poolId] = to + 1;
            if (to < lastClosed) return 0;
            revert Nothing();
        }

        bool zeroForOne = false;
        uint160 priceLimit = 0;
        uint256 limitOut = 0;
        if (holderIn > 0) {
            (int24 twap, int24 spot, bool direction) = _guard(holderIn);
            zeroForOne = direction;
            TwapGuard.assertBand(spot, twap);
            uint256 twapOut = _rawOut(holderIn, twap, zeroForOne);
            uint256 floor = TwapGuard.minOut(holderIn, twap, zeroForOne);
            (uint256 lower, uint256 upper) = _band(twapOut, floor);
            if (minOut < lower || minOut > upper) revert Slippage();
            limitOut = minOut > floor ? minOut : floor;
            priceLimit = _priceLimit(zeroForOne, twap);
        }

        nextHarvestEpoch[poolId] = to + 1;
        (uint256 pulled, uint256 protocolOut) = hook.debitZroEpochs(poolId, epochs, protocolRecipient);
        if (pulled != holderIn) revert Nothing();
        if (pulled > 0) {
            zroOut = _swap(zeroForOne, pulled, limitOut, priceLimit);
            uint256[] memory parts = ZroRoundSplit.shares(zroOut, weights);
            IERC20(zro).forceApprove(address(vault), zroOut);
            for (uint256 i; i < span; ++i) {
                if (parts[i] == 0) continue;
                vault.fund(poolId, epochs[i], parts[i]);
            }
        }
        emit Harvested(poolId, from, pulled, zroOut, protocolOut);
    }

    /// @notice Holder-tax still inside the next harvest batch. Quote `minOut` against this amount.
    function nextHolderIn(PoolId poolId) external view returns (uint256 holderIn, uint64 fromEpoch, uint64 toEpoch) {
        (uint64 from, uint64 to,) = _harvestSpan(poolId);
        fromEpoch = from;
        toEpoch = to;
        uint256 span = uint256(to - from) + 1;
        for (uint256 i; i < span; ++i) {
            holderIn += hook.zroHolderEpoch(poolId, from + uint64(i));
        }
    }

    /// @dev `from` is the next unsettled hour. `to` is at most `MAX_ROUNDS` later and not past the
    ///      latest hour that has already ended. The open hour is never included.
    function _harvestSpan(PoolId poolId) internal view returns (uint64 from, uint64 to, uint64 lastClosed) {
        uint64 current = uint64(block.timestamp / ROUND_SECONDS);
        if (current == 0) revert Nothing();
        lastClosed = current - 1;
        from = nextHarvestEpoch[poolId];
        if (from == 0) {
            (,,,,, uint40 launchTime,) = hook.config(poolId);
            from = uint64(uint256(launchTime) / ROUND_SECONDS);
        }
        if (from > lastClosed) revert Nothing();
        uint64 capped = from + uint64(MAX_ROUNDS) - 1;
        to = capped > lastClosed ? lastClosed : capped;
    }

    function _protocolInSpan(PoolId poolId, uint64[] memory epochs) internal view returns (uint256 sum) {
        uint256 n = epochs.length;
        for (uint256 i; i < n; ++i) {
            sum += hook.zroProtocolEpoch(poolId, epochs[i]);
        }
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (bool zeroForOne, uint256 amountIn, uint256 minOut, uint160 priceLimit) =
            abi.decode(data, (bool, uint256, uint256, uint160));
        BalanceDelta delta = poolManager.swap(
            poolKey,
            SwapParams({zeroForOne: zeroForOne, amountSpecified: -_asInt(amountIn), sqrtPriceLimitX96: priceLimit}),
            ""
        );
        int128 received = zeroForOne ? delta.amount1() : delta.amount0();
        if (received <= 0 || uint256(uint128(received)) < minOut) revert TooLittleReceived();
        _settle(poolKey.currency0, delta.amount0());
        _settle(poolKey.currency1, delta.amount1());
        return abi.encode(uint256(uint128(received)));
    }

    function _guard(uint256 amountIn) internal returns (int24 twap, int24 spot, bool zeroForOne) {
        if (amountIn == 0) revert Nothing();
        (, spot,,) = poolManager.getSlot0(poolKey.toId());
        OracleLib.onSwap(_oracle, uint32(block.timestamp), spot);
        twap = OracleLib.consult(_oracle, uint32(block.timestamp), C.TWAP_WINDOW, spot);
        zeroForOne = Currency.unwrap(poolKey.currency0) == weth;
    }

    function _twap() internal view returns (int24 twap, bool zeroForOne) {
        (, int24 spot,,) = poolManager.getSlot0(poolKey.toId());
        twap = OracleLib.consult(_oracle, uint32(block.timestamp), C.TWAP_WINDOW, spot);
        TwapGuard.assertBand(spot, twap);
        zeroForOne = Currency.unwrap(poolKey.currency0) == weth;
    }

    function _band(uint256 twapOut, uint256 floor) internal view returns (uint256 lower, uint256 upper) {
        if (twapOut < 1) revert Slippage();
        lower = twapOut * (BPS - maxDeviationBps) / BPS;
        if (lower < floor) lower = floor;
        upper = twapOut * (BPS + maxDeviationBps) / BPS;
    }

    function _priceLimit(bool zeroForOne, int24 twap) internal view returns (uint160 limit) {
        int24 edge = zeroForOne ? twap - C.BAND_TICKS - 1 : twap + C.BAND_TICKS + 1;
        if (edge <= TickMath.MIN_TICK) edge = TickMath.MIN_TICK + 1;
        if (edge >= TickMath.MAX_TICK) edge = TickMath.MAX_TICK - 1;
        limit = TickMath.getSqrtPriceAtTick(edge);
        (uint160 sqrtP,,,) = poolManager.getSlot0(poolKey.toId());
        if (zeroForOne) {
            if (limit >= sqrtP) revert Slippage();
        } else if (limit <= sqrtP) {
            revert Slippage();
        }
    }

    function _rawOut(uint256 amountIn, int24 twapTick, bool zeroForOne) internal pure returns (uint256 raw) {
        if (amountIn == 0) return 0;
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(twapTick);
        if (zeroForOne) {
            raw = FullMath.mulDiv(amountIn, uint256(sqrtP), 1 << 96);
            raw = FullMath.mulDiv(raw, uint256(sqrtP), 1 << 96);
        } else {
            raw = FullMath.mulDiv(amountIn, 1 << 96, uint256(sqrtP));
            raw = FullMath.mulDiv(raw, 1 << 96, uint256(sqrtP));
        }
    }

    function _swap(bool zeroForOne, uint256 amountIn, uint256 minOut, uint160 priceLimit)
        internal
        returns (uint256 out)
    {
        bytes memory res = poolManager.unlock(abi.encode(zeroForOne, amountIn, minOut, priceLimit));
        out = abi.decode(res, (uint256));
    }

    function _settle(Currency token, int128 amt) internal {
        if (amt < 0) {
            poolManager.sync(token);
            IERC20(Currency.unwrap(token)).safeTransfer(address(poolManager), uint256(uint128(-amt)));
            poolManager.settle();
        } else if (amt > 0) {
            poolManager.take(token, address(this), uint256(uint128(amt)));
        }
    }

    function _admin(address account) internal view returns (bool) {
        return account == owner || account == timelock;
    }

    function _asInt(uint256 amount) internal pure returns (int256) {
        if (amount > uint256(type(int256).max)) revert Nothing();
        return int256(amount);
    }
}
