// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {SeedixConstants as C} from "./SeedixConstants.sol";

/// @notice Single-sided two-range seed. The pool price sits on the boundary so the position
///         holds only the coin. Buys move into that liquidity.
library LaunchCurve {
    error BadStartPrice();

    struct Range {
        int24 lower;
        int24 upper;
        uint128 liquidity;
    }

    struct Plan {
        uint160 sqrtPriceX96;
        int24 tick;
        bool coinIsToken0;
        Range near;
        Range far;
    }

    function plan(bool coinIsToken0, uint256 startMcapInPair, uint256 coinAmount)
        internal
        pure
        returns (Plan memory p)
    {
        if (startMcapInPair == 0 || coinAmount == 0) revert BadStartPrice();
        p.coinIsToken0 = coinIsToken0;
        uint256 num = coinIsToken0 ? startMcapInPair : C.SUPPLY;
        uint256 den = coinIsToken0 ? C.SUPPLY : startMcapInPair;
        uint160 raw = _sqrtPrice(num, den);
        int24 ideal = TickMath.getTickAtSqrtPrice(raw);
        int24 boundary = _alignNearest(ideal, C.TICK_SPACING);
        int24 minTick = TickMath.minUsableTick(C.TICK_SPACING);
        int24 maxTick = TickMath.maxUsableTick(C.TICK_SPACING);
        if (coinIsToken0) {
            if (boundary > maxTick - C.TICK_SPACING) revert BadStartPrice();
            int24 nearUpper = boundary + C.NEAR_WIDTH;
            if (nearUpper > maxTick) nearUpper = maxTick;
            p.near = Range({lower: boundary, upper: nearUpper, liquidity: 0});
            if (nearUpper < maxTick) {
                p.far = Range({lower: nearUpper, upper: maxTick, liquidity: 0});
            }
        } else {
            if (boundary < minTick + C.TICK_SPACING) revert BadStartPrice();
            int24 nearLower = boundary - C.NEAR_WIDTH;
            if (nearLower < minTick) nearLower = minTick;
            p.near = Range({lower: nearLower, upper: boundary, liquidity: 0});
            if (nearLower > minTick) {
                p.far = Range({lower: minTick, upper: nearLower, liquidity: 0});
            }
        }
        p.tick = boundary;
        p.sqrtPriceX96 = TickMath.getSqrtPriceAtTick(boundary);
        uint256 nearAmt = coinAmount * C.NEAR_BPS / 10_000;
        uint256 farAmt = coinAmount - nearAmt;
        if (p.far.lower == p.far.upper) {
            nearAmt = coinAmount;
            farAmt = 0;
        }
        p.near.liquidity = _liq(coinIsToken0, p.near, nearAmt);
        if (p.near.liquidity == 0) revert BadStartPrice();
        if (farAmt > 0) {
            p.far.liquidity = _liq(coinIsToken0, p.far, farAmt);
        }
    }

    function _liq(bool coinIsToken0, Range memory r, uint256 amount) private pure returns (uint128) {
        if (amount == 0 || r.lower >= r.upper) return 0;
        uint160 a = TickMath.getSqrtPriceAtTick(r.lower);
        uint160 b = TickMath.getSqrtPriceAtTick(r.upper);
        if (coinIsToken0) return LiquidityAmounts.getLiquidityForAmount0(a, b, amount);
        return LiquidityAmounts.getLiquidityForAmount1(a, b, amount);
    }

    function _sqrtPrice(uint256 numerator, uint256 denominator) private pure returns (uint160) {
        uint256 ratioX192 = FullMath.mulDiv(numerator, 1 << 192, denominator);
        uint256 root = _sqrt(ratioX192);
        if (root < TickMath.MIN_SQRT_PRICE || root >= TickMath.MAX_SQRT_PRICE) revert BadStartPrice();
        return uint160(root);
    }

    function _sqrt(uint256 x) private pure returns (uint256 z) {
        if (x == 0) return 0;
        z = x;
        uint256 y = (x + 1) / 2;
        while (y < z) {
            z = y;
            y = (x / y + y) / 2;
        }
    }

    function _alignNearest(int24 tick, int24 spacing) private pure returns (int24) {
        int24 compressed = tick / spacing;
        if (tick < 0 && tick % spacing != 0) compressed--;
        int24 down = compressed * spacing;
        int24 up = down + spacing;
        if (up > TickMath.MAX_TICK) return down;
        return (tick - down) <= (up - tick) ? down : up;
    }
}
