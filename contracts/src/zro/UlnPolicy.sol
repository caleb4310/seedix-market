// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {UlnConfig} from "@layerzerolabs/lz-evm-messagelib-v2/contracts/uln/UlnBase.sol";

/// @notice The send and receive ULN config for one pathway. At least two required DVNs, and at
///         least one of them is outside the per-chain LayerZero Labs set. Labs runs two DVNs on a
///         chain (the standard one and lzRead). Addresses come from config. Required DVNs are
///         sorted ascending, with no duplicates. This library does not pick a chain.
library UlnPolicy {
    error UlnPolicyFailed();

    uint32 internal constant CONFIG_TYPE_ULN = 2;

    function assertDvns(address[] memory required, address[] memory labs) internal pure {
        if (labs.length == 0 || required.length < 2) revert UlnPolicyFailed();
        bool outsider;
        for (uint256 i; i < required.length; ++i) {
            if (required[i] == address(0)) revert UlnPolicyFailed();
            if (i > 0 && required[i] <= required[i - 1]) revert UlnPolicyFailed();
            if (!_isLabs(required[i], labs)) outsider = true;
        }
        if (!outsider) revert UlnPolicyFailed();
    }

    function _isLabs(address dvn, address[] memory labs) private pure returns (bool) {
        for (uint256 i; i < labs.length; ++i) {
            if (labs[i] == address(0)) revert UlnPolicyFailed();
            if (labs[i] == dvn) return true;
        }
        return false;
    }

    function encode(uint64 confirmations, address[] memory required) internal pure returns (bytes memory) {
        UlnConfig memory config = UlnConfig({
            confirmations: confirmations,
            requiredDVNCount: uint8(required.length),
            optionalDVNCount: 0,
            optionalDVNThreshold: 0,
            requiredDVNs: required,
            optionalDVNs: new address[](0)
        });
        return abi.encode(config);
    }

    function assertEncoded(bytes memory raw, address[] memory required, address[] memory labs) internal pure {
        UlnConfig memory config = abi.decode(raw, (UlnConfig));
        if (config.requiredDVNCount != required.length) revert UlnPolicyFailed();
        if (config.requiredDVNs.length != required.length) revert UlnPolicyFailed();
        for (uint256 i; i < required.length; ++i) {
            if (config.requiredDVNs[i] != required[i]) revert UlnPolicyFailed();
        }
        assertDvns(config.requiredDVNs, labs);
    }
}
