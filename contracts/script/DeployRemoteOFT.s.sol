// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {ZroRemoteOFT} from "../src/zro/ZroRemoteOFT.sol";
import {ZroChain} from "./ZroChain.sol";

/// @notice Deploys the mint/burn OFT for a destination chain. Name and symbol are copied from the
///         home coin via the environment. On a mainnet chain id this refuses MockZRO and requires
///         the canonical ZRO check to be a separate assertion: this script deploys a coin OFT, not ZRO.
///         PRIVATE_KEY is never logged.
contract DeployRemoteOFT is ZroChain {
    error MainnetDelay();

    function run() external {
        Addrs memory chain = _load();
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address owner = vm.envAddress("ZRO_OWNER");
        address timelock = vm.envAddress("ZRO_TIMELOCK");
        string memory name_ = vm.envString("COIN_NAME");
        string memory symbol_ = vm.envString("COIN_SYMBOL");
        uint256 minDelay = vm.envOr("MIN_DELAY", uint256(60));
        address broadcaster = vm.addr(pk);
        if (block.chainid == 1 || block.chainid == 8453 || block.chainid == 42161) {
            if (minDelay < 48 hours) revert MainnetDelay();
            if (owner == broadcaster) revert MainnetDelay();
        }
        vm.startBroadcast(pk);
        ZroRemoteOFT oft = new ZroRemoteOFT(name_, symbol_, chain.lzEndpoint, owner, timelock, minDelay);
        vm.stopBroadcast();
        console2.log("remoteOft", address(oft));
        console2.log("endpoint", chain.lzEndpoint);
    }
}
