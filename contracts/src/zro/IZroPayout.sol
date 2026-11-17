// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Phase 2 payout. The vault already accounted the claim. The holder pays `msg.value`,
///         which is the LayerZero fee. Phase 1 leaves the module unset and transfers ZRO locally.
interface IZroPayout {
    function payout(address zro, address to, uint256 amount, uint32 dstEid, bytes calldata options) external payable;
}
