// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title TestOwner
/// @notice TEST ONLY. A one-address stand-in used when the canonical Safe factory has no code on
///         the target chain. It is not a multisig and it is not for mainnet. Base Sepolia prefers
///         a 1-of-1 Safe from the factory in `config/chains/84532.json`.
contract TestOwner {
    error NotOwner();
    error CallFailed();

    address public owner;

    event Executed(address indexed target, uint256 value, bytes data);

    constructor(address owner_) {
        if (owner_ == address(0)) revert NotOwner();
        owner = owner_;
    }

    function execute(address target, uint256 value, bytes calldata data) external returns (bytes memory) {
        if (msg.sender != owner) revert NotOwner();
        (bool ok, bytes memory ret) = target.call{value: value}(data);
        if (!ok) revert CallFailed();
        emit Executed(target, value, data);
        return ret;
    }
}
