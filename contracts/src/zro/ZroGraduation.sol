// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ZroAdapterFactory} from "./ZroAdapterFactory.sol";
import {ZroWeightTracker} from "./ZroWeightTracker.sol";

interface ILaunchedCoins {
    function isLaunchedCoin(address coin) external view returns (bool);
}

/// @notice Gives one Seedix coin its home-chain lockbox. The endpoint comes from chain config.
///         Peers are not set here. The timelock sets them on the adapter.
///
///         A coin is accepted when the launcher reports `isLaunchedCoin`, or when that call is
///         missing and the Safe or the timelock has `allowCoin`'d it. The live Base Sepolia
///         launcher has no `isLaunchedCoin`. That stack does not need a new launcher: the Safe
///         allowlists the coin on this contract.
///
///         When `tracker` is a tracker from this codebase, this contract must already be its
///         excluder. The adapter is excluded for that coin only. The live tracker has no
///         `excluder()` and no per-token exclusion. Construct this with `tracker = address(0)`
///         and have the Safe call the live tracker's `setExcluded(adapter, true)` in the same
///         batch. `SafeGraduateLive` writes that batch and does not broadcast it.
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
    ZroAdapterFactory public immutable adapterFactory;
    /// @notice The only adapter for this coin. A second `ZroCoinAdapter` cannot be created here.
    mapping(address coin => address adapter) public adapterOf;
    /// @notice Coins the Safe or the timelock has accepted. Used when the launcher predates
    ///         `isLaunchedCoin`.
    mapping(address coin => bool) public allowedCoin;
    uint256 private _locked;

    event Graduated(address indexed coin, address indexed adapter);
    event CoinAllowed(address indexed coin, bool allowed);

    constructor(address endpoint_, address owner_, address timelock_, address tracker_, address launcher_) {
        if (endpoint_ == address(0) || owner_ == address(0) || timelock_ == address(0) || launcher_ == address(0)) {
            revert NotAdmin();
        }
        endpoint = endpoint_;
        owner = owner_;
        timelock = timelock_;
        tracker = ZroWeightTracker(tracker_);
        launcher = launcher_;
        ZroAdapterFactory created = new ZroAdapterFactory();
        created.bind(address(this));
        adapterFactory = created;
    }

    /// @notice Safe or timelock. The live launcher cannot answer `isLaunchedCoin`, so this is how
    ///         an already-deployed coin is graduated without redeploying the launcher.
    function allowCoin(address coin, bool allowed) external {
        if (msg.sender != owner && msg.sender != timelock) revert NotAdmin();
        if (coin == address(0)) revert NotSeedixCoin();
        allowedCoin[coin] = allowed;
        emit CoinAllowed(coin, allowed);
    }

    function graduate(address coin) external returns (address adapter) {
        if (msg.sender != owner && msg.sender != timelock) revert NotAdmin();
        if (coin == address(0) || adapterOf[coin] != address(0)) revert AlreadyGraduated();
        if (!_known(coin)) revert NotSeedixCoin();
        if (_locked == 1) revert Reentered();
        _locked = 1;
        _requireExclude();
        adapter = adapterFactory.deploy(coin, endpoint, owner, timelock);
        adapterOf[coin] = adapter;
        if (address(tracker) != address(0)) {
            tracker.registerCoin(coin);
            tracker.setExcluded(adapter, coin, true);
        }
        emit Graduated(coin, adapter);
        _locked = 0;
    }

    /// @dev The launcher's view wins when it exists. A revert there means the live bytecode, and
    ///      the allowlist is the fallback. A view that returns false is not overridden by a stale
    ///      allowlist entry: the Safe can still allow a coin the view does not know.
    function _known(address coin) internal view returns (bool) {
        try ILaunchedCoins(launcher).isLaunchedCoin(coin) returns (bool launched) {
            if (launched) return true;
        } catch {}
        return allowedCoin[coin];
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
