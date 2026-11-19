// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ZroGraduation} from "../src/zro/ZroGraduation.sol";
import {ZroWeightTracker} from "../src/zro/ZroWeightTracker.sol";

/// @notice Live Base Sepolia batch. The phase-1 tracker has no `excluder()`, so graduation is
///         constructed with tracker = address(0). The Safe then excludes the adapter before anyone
///         can lock coins. Run both calls from the Safe in one batch. PRIVATE_KEY is never logged.
contract SafeGraduateLive is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        ZroGraduation grad = ZroGraduation(vm.envAddress("GRADUATION"));
        ZroWeightTracker tracker = ZroWeightTracker(vm.envAddress("TRACKER"));
        address coin = vm.envAddress("COIN");
        vm.startBroadcast(pk);
        address adapter = grad.graduate(coin);
        tracker.setExcluded(adapter, true);
        vm.stopBroadcast();
        console2.log("adapter", adapter);
        console2.log("excluded", tracker.excluded(adapter) ? 1 : 0);
    }
}
