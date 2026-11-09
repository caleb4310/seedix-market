// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "@uniswap/v4-core/src/libraries/FixedPoint96.sol";

/// @notice WHYPE sitting in the active liquidity across one tick spacing.
///         A position only one spacing wide can pass this and still be thin
///         across the 2% buyback band. The TWAP band is what stops that trade.
library RouteDepth {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function whypeInNextSpacing(IPoolManager pm, PoolKey memory key, Currency whype) internal view returns (uint256) {
        (uint160 sqrtP, int24 tick,,) = pm.getSlot0(key.toId());
        uint128 liquidity = pm.getLiquidity(key.toId());
        if (liquidity == 0 || sqrtP == 0 || key.tickSpacing == 0) return 0;
        bool whype0 = Currency.unwrap(key.currency0) == Currency.unwrap(whype);
        int24 dest = whype0 ? tick + key.tickSpacing : tick - key.tickSpacing;
        if (dest < TickMath.MIN_TICK) dest = TickMath.MIN_TICK;
        if (dest > TickMath.MAX_TICK) dest = TickMath.MAX_TICK;
        uint160 sqrtD = TickMath.getSqrtPriceAtTick(dest);
        if (whype0) return _amount0(sqrtP, sqrtD, liquidity);
        return _amount1(sqrtD, sqrtP, liquidity);
    }

    function _amount0(uint160 sqrtA, uint160 sqrtB, uint128 liquidity) private pure returns (uint256) {
        if (sqrtA > sqrtB) (sqrtA, sqrtB) = (sqrtB, sqrtA);
        if (sqrtA == 0 || sqrtB == sqrtA) return 0;
        return
            FullMath.mulDiv(
                uint256(liquidity), uint256(sqrtB - sqrtA) * FixedPoint96.Q96, uint256(sqrtA) * uint256(sqrtB)
            );
    }

    function _amount1(uint160 sqrtA, uint160 sqrtB, uint128 liquidity) private pure returns (uint256) {
        if (sqrtA > sqrtB) (sqrtA, sqrtB) = (sqrtB, sqrtA);
        if (sqrtB == sqrtA) return 0;
        return FullMath.mulDiv(uint256(liquidity), uint256(sqrtB - sqrtA), FixedPoint96.Q96);
    }
}
