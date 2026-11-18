// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EnforcedOptionParam} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppOptionsType3.sol";
import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";

/// @notice Locks an existing Seedix coin and bridges it. LaunchToken is a clone, so it cannot be
///         an OFT itself: an OFT needs a constructor, and a clone does not run one. The hook and
///         the weight tracker stay on the coin's own transfers.
///
///         `owner` is the Safe. `timelock` may set peers and enforced options as well. The endpoint
///         and every destination id are arguments. None of them are stored as literals here.
contract ZroCoinAdapter is OFTAdapter {
    error NotAdmin();

    address public timelock;

    constructor(address token, address endpoint, address delegate, address owner_, address timelock_)
        OFTAdapter(token, endpoint, delegate)
        Ownable(owner_)
    {
        if (owner_ == address(0) || timelock_ == address(0)) revert NotAdmin();
        timelock = timelock_;
    }

    function setPeer(uint32 eid, bytes32 peer) public override {
        _admin();
        _setPeer(eid, peer);
    }

    function setEnforcedOptions(EnforcedOptionParam[] calldata enforced) public override {
        _admin();
        _setEnforcedOptions(enforced);
    }

    function _admin() internal view {
        if (msg.sender != owner() && msg.sender != timelock) revert NotAdmin();
    }
}
