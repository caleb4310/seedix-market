// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ZroCoinAdapter} from "./ZroCoinAdapter.sol";
import {ZroWeightTracker} from "./ZroWeightTracker.sol";

interface ILaunchedCoins {
    function isLaunchedCoin(address coin) external view returns (bool);
}

/// @notice Gives one Seedix coin its home-chain lockbox. The endpoint comes from chain config.
///         Peers are not set here. The timelock sets them on the adapter.
///
///         When `tracker` is set, this contract must already be its owner or its excluder, and the
///         adapter is excluded before it can hold a balance. The live phase-1 tracker has no
///         `excluder()`; wiring that tracker reverts `TrackerHasNoExcluder`. Graduate that stack
///         with `tracker = address(0)` and have the Safe call `setExcluded` in the same batch.
contract ZroGraduation {
    error NotAdmin();
    error NotSeedixCoin();
    error AlreadyGraduated();
    error Reentered();
    error CannotExclude();
    error TrackerHasNoExcluder();

    address public immutable endpoint;
    address public immutable owner;
    address public immutable timelock;
    address public immutable launcher;
    ZroWeightTracker public immutable tracker;
    /// @notice The only adapter for this coin. A second `ZroCoinAdapter` cannot be created here.
    mapping(address coin => address adapter) public adapterOf;
    uint256 private _locked;

    event Graduated(address indexed coin, address indexed adapter);

    constructor(address endpoint_, address owner_, address timelock_, address tracker_, address launcher_) {
        if (endpoint_ == address(0) || owner_ == address(0) || timelock_ == address(0) || launcher_ == address(0)) {
            revert NotAdmin();
        }
        endpoint = endpoint_;
        owner = owner_;
        timelock = timelock_;
        tracker = ZroWeightTracker(tracker_);
        launcher = launcher_;
    }

    function graduate(address coin) external returns (address adapter) {
        if (msg.sender != owner && msg.sender != timelock) revert NotAdmin();
        if (coin == address(0) || adapterOf[coin] != address(0)) revert AlreadyGraduated();
        if (!ILaunchedCoins(launcher).isLaunchedCoin(coin)) revert NotSeedixCoin();
        if (_locked == 1) revert Reentered();
        _locked = 1;
        _requireExclude();
        adapter = address(new ZroCoinAdapter(coin, endpoint, owner, owner, timelock, address(this)));
        adapterOf[coin] = adapter;
        if (address(tracker) != address(0)) tracker.setExcluded(adapter, true);
        emit Graduated(coin, adapter);
        _locked = 0;
    }

    /// @dev Reverts unless this contract can exclude the adapter, or no tracker was wired.
    function _requireExclude() internal view {
        if (address(tracker) == address(0)) return;
        try tracker.excluder() returns (address ex) {
            if (ex != address(this) && tracker.owner() != address(this)) revert CannotExclude();
        } catch {
            revert TrackerHasNoExcluder();
        }
    }
}
