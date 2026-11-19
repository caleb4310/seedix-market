// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ZroWeightTracker} from "../src/zro/ZroWeightTracker.sol";

/// @notice Confirms the tracker excluder. No broadcast.
contract VerifyExcluder is Script {
    error ExcluderMismatch(address have, address want);

    function run() external view {
        ZroWeightTracker tracker = ZroWeightTracker(vm.envAddress("TRACKER"));
        address graduation = vm.envAddress("GRADUATION");
        address have = tracker.excluder();
        if (have != graduation) revert ExcluderMismatch(have, graduation);
        console2.log("excluder", have);
    }
}
