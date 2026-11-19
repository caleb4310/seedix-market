// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {EnforcedOptionParam} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppOptionsType3.sol";
import {OFT} from "@layerzerolabs/oft-evm/contracts/OFT.sol";

/// @notice Mint/burn OFT for a coin on a chain that is not its home. One home lockbox is the only
///         adapter in the mesh. This contract mints on receive and burns on send. `sharedDecimals`
///         stays 6, from the OFT base. Peers are timelock-only. Name and symbol are constructor
///         arguments copied from the home coin, not literals of a chain.
contract ZroRemoteOFT is OFT {
    error NotTimelock();
    error Delay();

    address public immutable timelock;

    constructor(
        string memory name_,
        string memory symbol_,
        address endpoint,
        address delegate,
        address owner_,
        address timelock_,
        uint256 minDelay
    ) OFT(name_, symbol_, endpoint, delegate) Ownable(owner_) {
        if (owner_ == address(0) || timelock_ == address(0)) revert NotTimelock();
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
}
