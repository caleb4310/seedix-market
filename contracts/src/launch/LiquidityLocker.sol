// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LaunchHook} from "../hook/LaunchHook.sol";
import {LaunchCurve} from "../libraries/LaunchCurve.sol";

/// @notice Holds the launch position forever. LP fees are pulled to the fee recipient,
///         or to the buyback executor for the platform token.
contract LiquidityLocker is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;

    error NotPoolManager();
    error NotLauncher();
    error NotInitializer();
    error NotSeeded();
    error SeedNeedsPair();

    struct Position {
        int24 lower;
        int24 upper;
        bytes32 salt;
        uint128 liquidity;
    }

    IPoolManager public immutable poolManager;
    address public immutable initializer;
    LaunchHook public hook;
    address public launcher;
    address public buybackExecutor;

    mapping(PoolId => Position) public nearPos;
    mapping(PoolId => Position) public farPos;
    mapping(PoolId => address) public lpRecipientOverride;

    constructor(IPoolManager poolManager_, address initializer_) {
        if (initializer_ == address(0)) revert NotInitializer();
        poolManager = poolManager_;
        initializer = initializer_;
    }

    function wire(LaunchHook hook_, address launcher_, address buybackExecutor_) external {
        if (msg.sender != initializer || address(hook) != address(0)) revert NotInitializer();
        hook = hook_;
        launcher = launcher_;
        buybackExecutor = buybackExecutor_;
    }

    function setLpRecipient(PoolId id, address to) external {
        if (msg.sender != launcher || to == address(0)) revert NotLauncher();
        lpRecipientOverride[id] = to;
    }

    function seed(PoolKey calldata key, LaunchCurve.Range calldata near, LaunchCurve.Range calldata far) external {
        if (msg.sender != launcher) revert NotLauncher();
        poolManager.unlock(abi.encode(uint8(1), key, near, far));
    }

    /// @notice Anyone may call. Tokens are paid to the fee recipient, never to the caller.
    function collect(PoolId id) external returns (uint128 amount0, uint128 amount1) {
        PoolKey memory key = hook.keyOf(id);
        address to = lpRecipientOverride[id];
        if (to == address(0)) to = _recipient(id);
        bytes memory res = poolManager.unlock(abi.encode(uint8(2), key, id, to));
        (amount0, amount1) = abi.decode(res, (uint128, uint128));
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        uint8 action = abi.decode(data, (uint8));
        if (action == 1) {
            return _seedCallback(data);
        }
        return _collectCallback(data);
    }

    function _seedCallback(bytes calldata data) internal returns (bytes memory) {
        (, PoolKey memory key, LaunchCurve.Range memory near, LaunchCurve.Range memory far) =
            abi.decode(data, (uint8, PoolKey, LaunchCurve.Range, LaunchCurve.Range));
        _seed(key, near, far);
        return "";
    }

    function _collectCallback(bytes calldata data) internal returns (bytes memory) {
        (, PoolKey memory key, PoolId id, address to) = abi.decode(data, (uint8, PoolKey, PoolId, address));
        return _collect(key, id, to);
    }

    function _seed(PoolKey memory key, LaunchCurve.Range memory near, LaunchCurve.Range memory far) internal {
        BalanceDelta total = _add(key, near, bytes32(uint256(1)));
        if (far.liquidity > 0) total = total + _add(key, far, bytes32(uint256(2)));
        _pay(key.currency0, total.amount0());
        _pay(key.currency1, total.amount1());
        PoolId id = key.toId();
        nearPos[id] = Position(near.lower, near.upper, bytes32(uint256(1)), near.liquidity);
        if (far.liquidity > 0) farPos[id] = Position(far.lower, far.upper, bytes32(uint256(2)), far.liquidity);
    }

    function _add(PoolKey memory key, LaunchCurve.Range memory range, bytes32 salt)
        internal
        returns (BalanceDelta delta)
    {
        (delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: range.lower,
                tickUpper: range.upper,
                liquidityDelta: int256(uint256(range.liquidity)),
                salt: salt
            }),
            ""
        );
    }

    function _pay(Currency c, int128 amt) internal {
        if (amt < 0) {
            uint256 owe = uint256(uint128(-amt));
            poolManager.sync(c);
            IERC20(Currency.unwrap(c)).safeTransfer(address(poolManager), owe);
            poolManager.settle();
        } else if (amt > 0) {
            // A positive seed delta is the pair token coming back. The executor routes it into a burn pot.
            poolManager.take(c, buybackExecutor, uint256(uint128(amt)));
        }
    }

    function _collect(PoolKey memory key, PoolId id, address to) internal returns (bytes memory) {
        if (nearPos[id].liquidity == 0) revert NotSeeded();
        BalanceDelta a = _poke(key, nearPos[id]);
        BalanceDelta b;
        if (farPos[id].liquidity > 0) b = _poke(key, farPos[id]);
        BalanceDelta total = a + b;
        uint128 out0 = _takeOut(key.currency0, total.amount0(), to);
        uint128 out1 = _takeOut(key.currency1, total.amount1(), to);
        return abi.encode(out0, out1);
    }

    function _poke(PoolKey memory key, Position memory pos) internal returns (BalanceDelta delta) {
        (delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: pos.lower, tickUpper: pos.upper, liquidityDelta: 0, salt: pos.salt}),
            ""
        );
    }

    function _takeOut(Currency c, int128 amt, address to) internal returns (uint128 out) {
        if (amt > 0) {
            out = uint128(amt);
            poolManager.take(c, to, out);
        } else if (amt < 0) {
            revert SeedNeedsPair();
        }
    }

    function _recipient(PoolId id) internal view returns (address) {
        (,,,,,, address feeRecipient) = hook.config(id);
        return feeRecipient;
    }
}
