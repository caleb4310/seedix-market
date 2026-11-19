// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ZroWeightTracker} from "../src/zro/ZroWeightTracker.sol";

/// @notice Safe (the tracker owner) sets the timelock, then the timelock sets the graduation
///         contract as the excluder. Env only. PRIVATE_KEY is never logged.
contract SafeSetExcluder is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        ZroWeightTracker tracker = ZroWeightTracker(vm.envAddress("TRACKER"));
        address timelock = vm.envAddress("ZRO_TIMELOCK");
        address graduation = vm.envAddress("GRADUATION");
        vm.startBroadcast(pk);
        if (tracker.timelock() == address(0)) tracker.setTimelock(timelock);
        vm.stopBroadcast();
        console2.log("tracker", address(tracker));
        console2.log("timelock", timelock);
        console2.log("graduation", graduation);
        console2.log("excluder must be set by the timelock");
    }
}
