// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {SeedixConstants as C} from "./SeedixConstants.sol";

/// @notice Fee rates and gross-up. Exact-in rounds down. Exact-out rounds the gross up so the
///         trader pays at least the designed rate. See contracts/docs/fees.md.
library FeeMath {
    error FeePipsTooHigh();

    /// @dev Whole seconds since launch. 80% at 0, then minus 7.9% each second, 1% from 10s on.
    function hookFeePips(uint256 launchTime, uint256 nowTs) internal pure returns (uint256) {
        if (nowTs <= launchTime) return C.START_FEE;
        uint256 elapsed = nowTs - launchTime;
        if (elapsed >= C.DECAY_SECONDS) return C.END_FEE;
        return C.START_FEE - (C.START_FEE - C.END_FEE) * elapsed / C.DECAY_SECONDS;
    }

    function feeDown(uint256 gross, uint256 pips) internal pure returns (uint256) {
        return gross * pips / C.PIPS;
    }

    /// @notice Exact-in buy: both lines are a floor fraction of the specified pair input.
    function exactInBuy(uint256 gross, uint256 hookPips) internal pure returns (uint256 hookAmt, uint256 platAmt) {
        hookAmt = feeDown(gross, hookPips);
        platAmt = feeDown(gross, C.PLATFORM_FEE);
    }

    /// @notice `gross = ceil(net * 1e6 / (1e6 - pips))`, `fee = gross - net`.
    function grossUp(uint256 net, uint256 pips) internal pure returns (uint256 gross, uint256 fee) {
        if (pips == 0 || net == 0) return (net, 0);
        if (pips >= C.PIPS) revert FeePipsTooHigh();
        gross = FullMath.mulDivRoundingUp(net, C.PIPS, C.PIPS - pips);
        fee = gross - net;
    }

    /// @notice Exact-out buy. One gross-up on the sum of the rates, then a proportional split.
    ///         The remainder of the fee goes to the platform line so the parts sum to the fee taken.
    function splitGross(uint256 net, uint256 hookPips) internal pure returns (uint256 hookAmt, uint256 platAmt) {
        uint256 total = hookPips + C.PLATFORM_FEE;
        (, uint256 fee) = grossUp(net, total);
        if (fee == 0) return (0, 0);
        hookAmt = fee * hookPips / total;
        platAmt = fee - hookAmt;
    }

    /// @notice While the decay is active, only the 1% base follows the coin mode.
    ///         The remainder buys the coin back (pair side) or is burned (coin side).
    function splitBaseExcess(uint256 hookAmt, uint256 hookPips)
        internal
        pure
        returns (uint256 baseAmt, uint256 excessAmt)
    {
        if (hookAmt == 0 || hookPips <= C.END_FEE) return (hookAmt, 0);
        baseAmt = hookAmt * C.END_FEE / hookPips;
        excessAmt = hookAmt - baseAmt;
    }

    function splitPlatform(uint256 platAmt, bool isPlatform) internal pure returns (uint256 burn, uint256 wallet) {
        if (platAmt == 0) return (0, 0);
        if (isPlatform) return (platAmt, 0);
        burn = platAmt / 2;
        wallet = platAmt - burn;
    }

    /// @dev Flat-price illustration of a buy, including the 0.1% LP fee on what reaches the pool.
    function quoteBuy(uint256 gross, uint256 hookPips)
        internal
        pure
        returns (uint256 platform, uint256 hookAmt, uint256 lp, uint256 coinWorth)
    {
        (hookAmt, platform) = exactInBuy(gross, hookPips);
        uint256 toPool = gross - platform - hookAmt;
        lp = toPool * uint256(C.LP_FEE) / C.PIPS;
        coinWorth = toPool - lp;
    }
}
