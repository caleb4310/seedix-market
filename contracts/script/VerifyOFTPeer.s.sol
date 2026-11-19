// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

interface IPeers {
    function peers(uint32 eid) external view returns (bytes32);
}

/// @notice Reads `peers(REMOTE_EID)` on this chain's OFT. No broadcast. Run once per chain.
contract VerifyOFTPeer is Script {
    error PeerMismatch(bytes32 have, bytes32 want);

    function run() external view {
        address oft = vm.envAddress("OFT");
        address peer = vm.envAddress("PEER");
        uint32 remoteEid = uint32(vm.envUint("REMOTE_EID"));
        bytes32 want = bytes32(uint256(uint160(peer)));
        bytes32 have = IPeers(oft).peers(remoteEid);
        if (have != want) revert PeerMismatch(have, want);
        console2.log("oft", oft);
        console2.log("peer ok");
    }
}
