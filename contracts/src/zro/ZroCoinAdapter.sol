// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EnforcedOptionParam} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppOptionsType3.sol";
import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";

/// @notice Home-chain lockbox for one Seedix coin. Only `ZroGraduation` can construct it, so
///         `adapterOf` on that contract is the registry. Peers and enforced options move only
///         through `timelock`. The delay itself is the timelock's `getMinDelay`.
contract ZroCoinAdapter is OFTAdapter {
    error NotTimelock();
    error NotGraduation();
    error ZeroAddress();

    address public immutable timelock;

    constructor(
        address token,
        address endpoint,
        address delegate,
        address owner_,
        address timelock_,
        address graduation
    ) OFTAdapter(token, endpoint, delegate) Ownable(owner_) {
        if (msg.sender != graduation) revert NotGraduation();
        if (owner_ == address(0) || timelock_ == address(0)) revert ZeroAddress();
        timelock = timelock_;
    }

    function setPeer(uint32 eid, bytes32 peer) public override {
        if (msg.sender != timelock) revert NotTimelock();
        _setPeer(eid, peer);
    }

    function setEnforcedOptions(EnforcedOptionParam[] calldata enforced) public override {
        if (msg.sender != timelock) revert NotTimelock();
        _setEnforcedOptions(enforced);
    }

    /// @notice Pulls ETH that a LayerZero option delivered here and nowhere else can withdraw.
    function sweep(address payable to) external {
        if (msg.sender != timelock) revert NotTimelock();
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = address(this).balance;
        if (bal == 0) revert ZeroAddress();
        (bool ok,) = to.call{value: bal}("");
        if (!ok) revert ZeroAddress();
    }
}
