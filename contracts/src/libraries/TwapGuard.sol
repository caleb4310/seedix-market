// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SeedixConstants as C} from "./SeedixConstants.sol";

/// @notice Spot-versus-TWAP band and a conservative min-out from the TWAP price.
library TwapGuard {
    error SpotOutsideBand(int24 spot, int24 twap);

    function assertBand(int24 spot, int24 twap) internal pure {
        int24 d = spot > twap ? spot - twap : twap - spot;
        if (d > C.BAND_TICKS) revert SpotOutsideBand(spot, twap);
    }

    /// @dev Constant-price quote, then 1% worse. Ignores impact, so real fills must beat it or revert.
    function minOut(uint256 amountIn, int24 twapTick, bool zeroForOne) internal pure returns (uint256) {
        if (amountIn == 0) return 0;
        uint160 sqrtP = TickMath.getSqrtPriceAtTick(twapTick);
        uint256 quote;
        if (zeroForOne) {
            quote = FullMath.mulDiv(amountIn, sqrtP, 1 << 96);
            quote = FullMath.mulDiv(quote, sqrtP, 1 << 96);
        } else {
            quote = FullMath.mulDiv(amountIn, 1 << 96, sqrtP);
            quote = FullMath.mulDiv(quote, 1 << 96, sqrtP);
        }
        return quote * C.MIN_OUT_PIPS / C.PIPS;
    }

    /// @dev The caller's minOut is a floor. The contract never accepts less than the TWAP floor.
    function effectiveMin(uint256 twapFloor, uint256 callerMin) internal pure returns (uint256) {
        return callerMin > twapFloor ? callerMin : twapFloor;
    }
}
