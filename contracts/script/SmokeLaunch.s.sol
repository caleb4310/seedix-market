// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Launcher} from "../src/launch/Launcher.sol";
import {LaunchHook} from "../src/hook/LaunchHook.sol";

/// @notice Launch one test coin with a 5% creator ZRO tax (6% ON_TOP). Local-only.
contract SmokeLaunch is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address launcherAddr = vm.envAddress("LAUNCHER_ADDRESS");
        address hookAddr = vm.envAddress("HOOK_ADDRESS");
        address weth = vm.envAddress("WETH");
        address creator = vm.addr(pk);
        uint16 taxBps = uint16(vm.envOr("CREATOR_TAX_BPS", uint256(500)));

        Launcher.LaunchParams memory params = Launcher.LaunchParams({
            name: "ZroSmoke",
            symbol: "ZSMOKE",
            pair: weth,
            mode: 2,
            feeRecipient: creator,
            teamWallet: address(0),
            teamBps: 0,
            startMcapInPair: 1 ether
        });

        vm.startBroadcast(pk);
        (address coin, PoolId id) = Launcher(launcherAddr).launchWithZroTax(params, taxBps);
        vm.stopBroadcast();

        (bool enabled, uint16 creatorBps, uint16 protocolBps, uint8 mode, uint16 effectiveBps) =
            LaunchHook(hookAddr).zroTax(id);
        console2.log("coin", coin);
        console2.log("poolId");
        console2.logBytes32(PoolId.unwrap(id));
        console2.log("taxEnabled", enabled ? 1 : 0);
        console2.log("creatorBps", creatorBps);
        console2.log("protocolBps", protocolBps);
        console2.log("feeMode", mode);
        console2.log("effectiveBps", effectiveBps);
        console2.log("creator", creator);
    }
}
