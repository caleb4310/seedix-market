// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

/// @notice Seedix protocol fee on the creator-set ZRO tax.
///         ON_TOP (the default) adds the protocol fee on top of the creator tax.
///         FROM_CREATOR_TAX takes the protocol fee out of that tax instead.
///         The trader's effective rate is capped at `MAX_EFFECTIVE_TAX_BPS` (10%).
///         The creator rate itself is capped at 9% so switching to ON_TOP cannot break the cap.
library ZroFeeMath {
    error Bound();
    error FeePipsTooHigh();

    uint8 internal constant FROM_CREATOR_TAX = 0;
    uint8 internal constant ON_TOP = 1;
    uint16 internal constant BPS = 10_000;
    uint16 internal constant MAX_PROTOCOL_FEE_BPS = 100;
    uint16 internal constant DEFAULT_PROTOCOL_FEE_BPS = 100;
    uint16 internal constant MAX_EFFECTIVE_TAX_BPS = 1_000;
    uint16 internal constant MAX_CREATOR_TAX_BPS = MAX_EFFECTIVE_TAX_BPS - MAX_PROTOCOL_FEE_BPS;

    function effective(uint16 creatorBps, uint16 protocolBps, uint8 mode) internal pure returns (uint16) {
        uint256 sum = mode == ON_TOP ? uint256(creatorBps) + protocolBps : uint256(creatorBps);
        if (sum > MAX_EFFECTIVE_TAX_BPS) revert Bound();
        return uint16(sum);
    }

    /// @dev Exact-in. Each line rounds down. ON_TOP charges both lines. FROM_CREATOR_TAX charges the
    ///      creator line and pays the protocol out of it, never more than that line.
    function splitExactIn(uint256 base, uint16 creatorBps, uint16 protocolBps, uint8 mode)
        internal
        pure
        returns (uint256 holderAmt, uint256 protocolAmt)
    {
        if (base == 0) return (0, 0);
        if (mode == ON_TOP) {
            holderAmt = base * creatorBps / BPS;
            protocolAmt = base * protocolBps / BPS;
            return (holderAmt, protocolAmt);
        }
        uint256 tax = base * creatorBps / BPS;
        protocolAmt = base * protocolBps / BPS;
        if (protocolAmt > tax) protocolAmt = tax;
        holderAmt = tax - protocolAmt;
    }

    /// @dev Exact-out. Gross up so the trader still receives `net`, then split the fee so the parts
    ///      sum to the fee taken. The remainder of a proportional split goes to the protocol line.
    function splitExactOut(uint256 net, uint16 creatorBps, uint16 protocolBps, uint8 mode)
        internal
        pure
        returns (uint256 holderAmt, uint256 protocolAmt)
    {
        uint256 eff = effective(creatorBps, protocolBps, mode);
        if (net == 0 || eff == 0) return (0, 0);
        if (eff >= BPS) revert FeePipsTooHigh();
        uint256 gross = FullMath.mulDivRoundingUp(net, BPS, BPS - eff);
        uint256 fee = gross - net;
        if (fee == 0) return (0, 0);
        if (mode == ON_TOP) {
            uint256 total = uint256(creatorBps) + protocolBps;
            holderAmt = fee * creatorBps / total;
            protocolAmt = fee - holderAmt;
            return (holderAmt, protocolAmt);
        }
        if (creatorBps == 0) return (0, 0);
        protocolAmt = fee * protocolBps / creatorBps;
        if (protocolAmt > fee) protocolAmt = fee;
        holderAmt = fee - protocolAmt;
    }
}
