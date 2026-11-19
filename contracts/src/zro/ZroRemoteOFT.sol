// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {EnforcedOptionParam} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppOptionsType3.sol";
import {SendParam} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {OFT} from "@layerzerolabs/oft-evm/contracts/OFT.sol";
import {OftRecipient} from "./OftRecipient.sol";

/// @notice Mint/burn OFT for a coin on a chain that is not its home. One home lockbox is the only
///         adapter in the mesh. This contract mints on receive and burns on send. `sharedDecimals`
///         stays 6, from the OFT base. Peers are timelock-only. The OApp owner is the timelock, so
///         `setDelegate` is timelock-only as well. Name and symbol are constructor arguments copied
///         from the home coin, not literals of a chain.
contract ZroRemoteOFT is OFT {
    error NotTimelock();
    error Delay();
    error ZeroAddress();

    address public immutable timelock;

    constructor(
        string memory name_,
        string memory symbol_,
        address endpoint,
        address delegate,
        address timelock_,
        uint256 minDelay
    ) OFT(name_, symbol_, endpoint, delegate) Ownable(timelock_) {
        if (delegate == address(0) || timelock_ == address(0)) revert NotTimelock();
        if (TimelockController(payable(timelock_)).getMinDelay() < minDelay) revert Delay();
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

    /// @dev `send` and `quoteSend` are external, so the recipient check lives on the shared builder.
    function _buildMsgAndOptions(SendParam calldata sendParam, uint256 amountLD)
        internal
        view
        override
        returns (bytes memory message, bytes memory options)
    {
        OftRecipient.check(sendParam.to);
        return super._buildMsgAndOptions(sendParam, amountLD);
    }

    /// @dev A zero address must not be remapped to the dead address. That burn cannot be undone.
    function _credit(address to, uint256 amountLD, uint32 srcEid) internal override returns (uint256) {
        if (to == address(0)) revert OftRecipient.BadRecipient();
        return super._credit(to, amountLD, srcEid);
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
