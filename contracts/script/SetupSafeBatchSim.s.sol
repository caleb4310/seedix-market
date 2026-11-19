// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {ZroGraduation} from "../src/zro/ZroGraduation.sol";
import {ZroWeightTracker} from "../src/zro/ZroWeightTracker.sol";
import {MockLzEndpoint} from "../src/zro/MockLzEndpoint.sol";

/// @notice Deploys the contracts the Safe-batch scripts read, on a local anvil only.
///         The three batch scripts themselves are run afterwards without `--broadcast`.
contract SetupSafeBatchSim is Script {
    function run() external {
        vm.startBroadcast();
        address[] memory roles = new address[](1);
        roles[0] = msg.sender;
        TimelockController timelock = new TimelockController(60, roles, roles, msg.sender);
        ZroWeightTracker tracker = new ZroWeightTracker(msg.sender, address(0), address(0), address(0));
        address list = address(new SimLauncher());
        ZroGraduation grad =
            new ZroGraduation(address(new MockLzEndpoint()), msg.sender, address(timelock), address(0), list);
        vm.stopBroadcast();
        string memory body = string.concat(
            "ZRO_TIMELOCK=",
            vm.toString(address(timelock)),
            "\nTRACKER=",
            vm.toString(address(tracker)),
            "\nGRADUATION=",
            vm.toString(address(grad)),
            "\nOFT=",
            vm.toString(address(grad)),
            "\nPEER=",
            vm.toString(address(tracker)),
            "\nCOIN=",
            vm.toString(address(list)),
            "\nREMOTE_EID=40245\nCHAIN_ID=31337\n"
        );
        vm.writeFile("out/safe/sim.env", body);
    }
}

contract SimLauncher {
    function isLaunchedCoin(address) external pure returns (bool) {
        return false;
    }
}
