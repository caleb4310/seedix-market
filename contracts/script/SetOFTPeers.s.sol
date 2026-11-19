// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {SafeOps} from "../src/zro/SafeOps.sol";
import {SafeBatch} from "./SafeBatch.sol";

/// @notice One chain, one peer. Run it on the home chain with OFT = the adapter and PEER = the
///         remote OFT, then again on the remote chain with the addresses swapped. The schedule
///         targets this chain's timelock only. This does not broadcast.
contract SetOFTPeers is SafeBatch {
    function run() external {
        address timelock = vm.envAddress("ZRO_TIMELOCK");
        address oft = vm.envAddress("OFT");
        address peer = vm.envAddress("PEER");
        uint32 remoteEid = uint32(vm.envUint("REMOTE_EID"));
        uint256 chainId = vm.envOr("CHAIN_ID", block.chainid);
        uint256 delay = vm.envOr("TIMELOCK_DELAY", uint256(0));
        if (delay == 0) delay = TimelockController(payable(timelock)).getMinDelay();
        bytes32 salt = keccak256(abi.encode(oft, peer, remoteEid, chainId));
        address[] memory to = new address[](1);
        bytes[] memory data = new bytes[](1);
        to[0] = timelock;
        data[0] = SafeOps.peerSchedule(oft, remoteEid, peer, salt, delay);
        _writeBatch(vm.envOr("SAFE_BATCH_OUT", string("out/safe/set-peer.json")), chainId, "set-oft-peer", to, data);
        console2.log("oft", oft);
        console2.log("peer", peer);
        console2.log("remoteEid", remoteEid);
    }
}
