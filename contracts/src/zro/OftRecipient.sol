// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice EVM OFT recipients are 20-byte addresses packed into bytes32. Zero and any high bit
///         would truncate to the zero address and either revert the receive or mint to the dead
///         address, which locks the coins that were burned on the source.
library OftRecipient {
    error BadRecipient();

    function check(bytes32 to) internal pure {
        if (to == bytes32(0) || uint256(to) >> 160 != 0) revert BadRecipient();
    }
}
