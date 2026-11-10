// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Seeds a hookless pair/WHYPE pool around tick 0.
///         The caller may pre-fund this contract. Any of either token that the position does not
///         take is sent back to the caller. WHYPE spent is what the pool kept.
contract RouteSeeder is IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;

    error NotPoolManager();
    error SeedFailed();

    int24 internal constant SPACING = 60;
    uint24 internal constant FEE = 3000;

    IPoolManager public poolManager;
    address public payer;
    uint256 private _entered;

    function seed(IPoolManager pm, address whype, address token, uint256 whypeTarget)
        external
        returns (PoolKey memory key, uint256 whypeSpent)
    {
        return seedWide(pm, whype, token, whypeTarget, 1);
    }

    /// @param widthSteps How many tick spacings each side of tick 0. One step keeps the WHYPE
    ///        cost near `whypeTarget`. A wider pool is for tests that need the price to move.
    function seedWide(IPoolManager pm, address whype, address token, uint256 whypeTarget, int24 widthSteps)
        public
        returns (PoolKey memory key, uint256 whypeSpent)
    {
        if (_entered == 1 || whypeTarget == 0 || token == address(0) || token == whype) revert SeedFailed();
        _entered = 1;
        poolManager = pm;
        payer = msg.sender;
        Currency w = Currency.wrap(whype);
        Currency t = Currency.wrap(token);
        (Currency c0, Currency c1) = uint160(token) < uint160(whype) ? (t, w) : (w, t);
        key = PoolKey({currency0: c0, currency1: c1, fee: FEE, tickSpacing: SPACING, hooks: IHooks(address(0))});
        if (widthSteps < 1) revert SeedFailed();
        pm.initialize(key, TickMath.getSqrtPriceAtTick(0));
        uint256 beforeWhype = IERC20(whype).balanceOf(address(this));
        pm.unlock(abi.encode(key, whype, whypeTarget, widthSteps));
        uint256 afterWhype = IERC20(whype).balanceOf(address(this));
        if (afterWhype > beforeWhype) revert SeedFailed();
        whypeSpent = beforeWhype - afterWhype;
        _sweep(whype);
        _sweep(token);
        _entered = 0;
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (PoolKey memory key, address whype, uint256 whypeTarget, int24 widthSteps) =
            abi.decode(data, (PoolKey, address, uint256, int24));
        bool whype0 = Currency.unwrap(key.currency0) == whype;
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(0);
        uint160 sqrtHi = TickMath.getSqrtPriceAtTick(SPACING);
        uint160 sqrtLo = TickMath.getSqrtPriceAtTick(-SPACING);
        uint128 liquidity = whype0
            ? LiquidityAmounts.getLiquidityForAmount0(sqrtP, sqrtHi, whypeTarget)
            : LiquidityAmounts.getLiquidityForAmount1(sqrtLo, sqrtP, whypeTarget);
        if (liquidity == 0) revert SeedFailed();
        (BalanceDelta delta,) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: -SPACING * widthSteps,
                tickUpper: SPACING * widthSteps,
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            ""
        );
        _pay(key.currency0, delta.amount0());
        _pay(key.currency1, delta.amount1());
        return "";
    }

    /// @dev Pays the pool from this contract first. A shortfall is pulled from the caller, so a
    ///      pre-fund larger than the position cannot be required.
    function _pay(Currency c, int128 amt) internal {
        if (amt < 0) {
            uint256 owe = uint256(uint128(-amt));
            address token = Currency.unwrap(c);
            uint256 here = IERC20(token).balanceOf(address(this));
            poolManager.sync(c);
            if (here >= owe) {
                IERC20(token).safeTransfer(address(poolManager), owe);
            } else {
                if (here > 0) IERC20(token).safeTransfer(address(poolManager), here);
                IERC20(token).safeTransferFrom(payer, address(poolManager), owe - here);
            }
            poolManager.settle();
        } else if (amt > 0) {
            poolManager.take(c, payer, uint256(uint128(amt)));
        }
    }

    function _sweep(address token) internal {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) IERC20(token).safeTransfer(payer, bal);
    }
}
