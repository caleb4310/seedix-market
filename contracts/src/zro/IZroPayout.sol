// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Phase 2 payout. The vault already accounted the claim. The holder pays `msg.value`,
///         which covers the LayerZero fee. Excess is refunded to the holder. Phase 1 leaves the
///         module unset and transfers ZRO locally.
interface IZroPayout {
    function quote(address zro, address to, uint256 amount, uint32 dstEid, bytes calldata options)
        external
        view
        returns (uint256 nativeFee);

    function payout(address zro, address to, uint256 amount, uint32 dstEid, bytes calldata options) external payable;
}
