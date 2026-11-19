// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {ZroCoinAdapter} from "../src/zro/ZroCoinAdapter.sol";
import {ZroRemoteOFT} from "../src/zro/ZroRemoteOFT.sol";

/// @notice Schedules both peer writes through the timelock. HOME_EID and REMOTE_EID come from the
///         environment. Execute after the delay with EXECUTE=1. PRIVATE_KEY is never logged.
contract SetOFTPeers is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        TimelockController tl = TimelockController(payable(vm.envAddress("ZRO_TIMELOCK")));
        address home = vm.envAddress("HOME_ADAPTER");
        address remote = vm.envAddress("REMOTE_OFT");
        uint32 homeEid = uint32(vm.envUint("HOME_EID"));
        uint32 remoteEid = uint32(vm.envUint("REMOTE_EID"));
        bytes32 salt = keccak256(abi.encode(home, remote, homeEid, remoteEid));
        bytes memory homeCall = abi.encodeCall(ZroCoinAdapter.setPeer, (remoteEid, bytes32(uint256(uint160(remote)))));
        bytes memory remoteCall = abi.encodeCall(ZroRemoteOFT.setPeer, (homeEid, bytes32(uint256(uint160(home)))));
        bool execute = vm.envOr("EXECUTE", false);
        vm.startBroadcast(pk);
        if (!execute) {
            tl.schedule(home, 0, homeCall, bytes32(0), salt, tl.getMinDelay());
            tl.schedule(remote, 0, remoteCall, bytes32(0), salt, tl.getMinDelay());
        } else {
            tl.execute(home, 0, homeCall, bytes32(0), salt);
            tl.execute(remote, 0, remoteCall, bytes32(0), salt);
        }
        vm.stopBroadcast();
        console2.log("home", home);
        console2.log("remote", remote);
        console2.log("execute", execute ? 1 : 0);
    }
}
