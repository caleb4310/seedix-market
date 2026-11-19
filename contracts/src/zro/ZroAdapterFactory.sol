// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ZroCoinAdapter} from "./ZroCoinAdapter.sol";

/// @notice Creates lockbox adapters for one graduation. `bind` is one shot. `deploy` accepts only
///         the bound graduation. The adapter checks that this factory is the one that graduation names.
contract ZroAdapterFactory {
    error NotGraduation();

    address public graduation;

    function bind(address grad) external {
        if (graduation != address(0) || grad == address(0)) revert NotGraduation();
        graduation = grad;
    }

    function deploy(address token, address endpoint, address delegate, address timelock) external returns (address) {
        if (msg.sender != graduation) revert NotGraduation();
        return address(new ZroCoinAdapter(token, endpoint, delegate, timelock));
    }
}
