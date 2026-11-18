// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ZroCoinAdapter} from "./ZroCoinAdapter.sol";
import {ZroWeightTracker} from "./ZroWeightTracker.sol";

/// @notice Gives one graduated coin an OFT adapter. The endpoint address is a constructor argument
///         taken from chain config. Peers and enforced options are not set here: the Safe or the
///         timelock sets them on the adapter after graduation.
contract ZroGraduation {
    error NotAdmin();
    error AlreadyGraduated();
    error Reentered();

    address public immutable endpoint;
    address public immutable owner;
    address public immutable timelock;
    ZroWeightTracker public immutable tracker;
    mapping(address coin => address adapter) public adapterOf;
    uint256 private _locked;

    event Graduated(address indexed coin, address indexed adapter);

    constructor(address endpoint_, address owner_, address timelock_, address tracker_) {
        if (endpoint_ == address(0) || owner_ == address(0) || timelock_ == address(0)) revert NotAdmin();
        endpoint = endpoint_;
        owner = owner_;
        timelock = timelock_;
        tracker = ZroWeightTracker(tracker_);
    }

    function graduate(address coin) external returns (address adapter) {
        if (msg.sender != owner && msg.sender != timelock) revert NotAdmin();
        if (coin == address(0) || adapterOf[coin] != address(0)) revert AlreadyGraduated();
        if (_locked == 1) revert Reentered();
        _locked = 1;
        adapter = address(new ZroCoinAdapter(coin, endpoint, owner, owner, timelock));
        adapterOf[coin] = adapter;
        if (address(tracker) != address(0) && (tracker.owner() == address(this) || tracker.excluder() == address(this)))
        {
            tracker.setExcluded(adapter, true);
        }
        emit Graduated(coin, adapter);
        _locked = 0;
    }
}
