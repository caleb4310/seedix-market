// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Just enough of EndpointV2 for an OFT constructor. `setDelegate` is the only call OFT makes
///         while it is deployed. Real sends use the Base Sepolia endpoint from chain config.
contract MockLzEndpoint {
    mapping(address oapp => address delegate) public delegates;

    function setDelegate(address delegate) external {
        delegates[msg.sender] = delegate;
    }
}
