// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ZroGraduation} from "../src/zro/ZroGraduation.sol";

interface ILiveExcluded {
    function excluded(address account) external view returns (bool);
}

/// @notice Reads the graduation registry and the live tracker's `excluded` flag. No broadcast.
contract VerifyGraduateLive is Script {
    error NotGraduated();
    error NotExcluded(address adapter);

    function run() external view {
        ZroGraduation grad = ZroGraduation(vm.envAddress("GRADUATION"));
        address tracker = vm.envAddress("TRACKER");
        address coin = vm.envAddress("COIN");
        address adapter = grad.adapterOf(coin);
        if (adapter == address(0)) revert NotGraduated();
        if (!ILiveExcluded(tracker).excluded(adapter)) revert NotExcluded(adapter);
        console2.log("adapter", adapter);
        console2.log("excluded", uint256(1));
    }
}
