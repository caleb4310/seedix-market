// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LaunchHook} from "../src/hook/LaunchHook.sol";
import {Launcher} from "../src/launch/Launcher.sol";
import {MockLzEndpoint} from "../src/zro/MockLzEndpoint.sol";
import {MockZRO} from "../src/zro/MockZRO.sol";
import {ZroRewardVault} from "../src/zro/ZroRewardVault.sol";
import {ZroTaxSwapper} from "../src/zro/ZroTaxSwapper.sol";
import {ZroWeightTracker} from "../src/zro/ZroWeightTracker.sol";
import {ZroChain} from "./ZroChain.sol";

/// @notice Deploys the Base Sepolia ZRO module. Refuses every chain except 84532 and local Anvil.
///         Does not touch the Elysium deployment. Do not pass --broadcast against a public RPC
///         unless the key is a throwaway testnet key and ZRO_OWNER / ZRO_DELEGATE are multisigs.
///         PRIVATE_KEY is never logged.
///
///         HOOK_ADDRESS is optional. When it is set, this key must be that hook's initializer.
contract DeployZro is ZroChain {
    error NeedsMultisig(address account);
    error HookMissing();

    function run() external {
        ZroChain.Addrs memory chain = _load();
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address owner = vm.envAddress("ZRO_OWNER");
        address delegate = vm.envAddress("ZRO_DELEGATE");
        address timelock = vm.envAddress("ZRO_TIMELOCK");
        address hookAddr = vm.envOr("HOOK_ADDRESS", address(0));
        address launcherAddr = vm.envOr("LAUNCHER_ADDRESS", address(0));
        address lockerAddr = vm.envOr("LOCKER_ADDRESS", address(0));
        address keeper = vm.envOr("KEEPER", address(0));
        if (block.chainid == 84532) {
            if (owner.code.length == 0) revert NeedsMultisig(owner);
            if (delegate.code.length == 0) revert NeedsMultisig(delegate);
            if (hookAddr == address(0)) revert HookMissing();
        }
        address broadcaster = vm.addr(pk);

        vm.startBroadcast(pk);
        address endpoint = chain.lzEndpoint;
        if (endpoint == address(0)) endpoint = address(new MockLzEndpoint());
        MockZRO zro = new MockZRO(endpoint, delegate, broadcaster);
        uint256 mintAmount = vm.envOr("SEED_ZRO_AMOUNT", uint256(0));
        if (mintAmount > 0) zro.mint(broadcaster, mintAmount);
        if (zro.owner() != owner) zro.transferOwnership(owner);

        ZroWeightTracker tracker = new ZroWeightTracker(broadcaster, hookAddr, chain.router, chain.poolManager);
        if (lockerAddr != address(0)) tracker.setExcluded(lockerAddr, true);
        if (launcherAddr != address(0)) tracker.setExcluded(launcherAddr, true);
        if (broadcaster != owner) tracker.setOwner(owner);

        if (hookAddr != address(0)) {
            LaunchHook hook = LaunchHook(hookAddr);
            ZroRewardVault vault =
                new ZroRewardVault(owner, delegate, timelock, broadcaster, IERC20(address(zro)), hook, tracker);
            ZroTaxSwapper swapper =
                new ZroTaxSwapper(broadcaster, timelock, owner, hook, vault, chain.weth, address(zro));
            vault.setSwapper(address(swapper));
            if (keeper != address(0)) swapper.setKeeper(keeper);
            if (broadcaster != owner) swapper.setOwner(owner);
            hook.setZroAdmin(owner, timelock);
            hook.setZroSwapper(address(swapper));
            if (launcherAddr != address(0)) Launcher(launcherAddr).setZroWeightTracker(address(tracker));
            console2.log("vault", address(vault));
            console2.log("swapper", address(swapper));
        }
        vm.stopBroadcast();

        console2.log("zro", address(zro));
        console2.log("tracker", address(tracker));
        console2.log("endpoint", endpoint);
        console2.log("poolManager", chain.poolManager);
        console2.log("lzEid", chain.lzEid);
    }
}
