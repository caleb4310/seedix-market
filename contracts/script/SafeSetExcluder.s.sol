// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {ZroWeightTracker} from "../src/zro/ZroWeightTracker.sol";
import {SafeBatch} from "./SafeBatch.sol";

/// @notice Safe batch for a tracker from this codebase. The owner sets the timelock once. The
///         proposer then schedules `setExcluder`. This does not broadcast. On the live Base
///         Sepolia timelock the deployer is still the proposer, so that schedule has to be sent
///         by the current proposer until the roles are moved. This script does not send it.
contract SafeSetExcluder is SafeBatch {
    function run() external {
        ZroWeightTracker tracker = ZroWeightTracker(vm.envAddress("TRACKER"));
        address timelock = vm.envAddress("ZRO_TIMELOCK");
        address graduation = vm.envAddress("GRADUATION");
        uint256 chainId = vm.envOr("CHAIN_ID", block.chainid);
        uint256 delay = TimelockController(payable(timelock)).getMinDelay();
        bool setClock = tracker.timelock() == address(0);
        uint256 n = setClock ? 2 : 1;
        address[] memory to = new address[](n);
        bytes[] memory data = new bytes[](n);
        uint256 i;
        if (setClock) {
            to[i] = address(tracker);
            data[i] = abi.encodeCall(ZroWeightTracker.setTimelock, (timelock));
            i++;
        }
        bytes memory inner = abi.encodeCall(ZroWeightTracker.setExcluder, (graduation));
        bytes32 salt = keccak256(abi.encode("set-excluder", address(tracker), graduation));
        to[i] = timelock;
        data[i] = abi.encodeCall(TimelockController.schedule, (address(tracker), 0, inner, bytes32(0), salt, delay));
        _writeBatch(vm.envOr("SAFE_BATCH_OUT", string("out/safe/set-excluder.json")), chainId, "set-excluder", to, data);
        console2.log("tracker", address(tracker));
        console2.log("graduation", graduation);
    }
}
