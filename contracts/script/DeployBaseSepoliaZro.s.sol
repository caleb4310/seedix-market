// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LaunchHook} from "../src/hook/LaunchHook.sol";
import {Launcher} from "../src/launch/Launcher.sol";
import {RouteSeeder} from "../src/launch/RouteSeeder.sol";
import {MockLzEndpoint} from "../src/zro/MockLzEndpoint.sol";
import {MockZRO} from "../src/zro/MockZRO.sol";
import {TestOwner} from "../src/zro/TestOwner.sol";
import {ZroRewardVault} from "../src/zro/ZroRewardVault.sol";
import {ZroTaxSwapper} from "../src/zro/ZroTaxSwapper.sol";
import {ZroMainnetGuard} from "../src/zro/ZroMainnetGuard.sol";
import {ZroWeightTracker} from "../src/zro/ZroWeightTracker.sol";
import {ZroChain} from "./ZroChain.sol";

interface ISafeProxyFactory {
    function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}

interface IWETH {
    function deposit() external payable;
}

/// @notice One broadcast for a Base Sepolia test deploy: a 1-of-1 Safe when the canonical factory
///         has code, otherwise a TEST-ONLY `TestOwner`, then a short TimelockController, then the
///         ZRO module and the ZRO/WETH pool. PRIVATE_KEY is never logged.
///         Command sequence: docs/zro-kickback.md.
contract DeployBaseSepoliaZro is ZroChain {
    error Amount();
    error SeedShort();

    function run() external {
        Addrs memory chain = _load();
        uint256 pk = vm.envUint("PRIVATE_KEY");
        uint256 zroAmount = vm.envUint("SEED_ZRO_AMOUNT");
        uint256 wethAmount = vm.envUint("SEED_WETH_AMOUNT");
        uint256 delay = vm.envOr("TIMELOCK_DELAY", uint256(60));
        if (delay == 0) delay = 60;
        address hookAddr = vm.envOr("HOOK_ADDRESS", address(0));
        address launcherAddr = vm.envOr("LAUNCHER_ADDRESS", address(0));
        address lockerAddr = vm.envOr("LOCKER_ADDRESS", address(0));
        address keeper = vm.envOr("KEEPER", address(0));
        if (zroAmount == 0 || wethAmount == 0 || chain.poolManager == address(0) || chain.weth == address(0)) {
            revert Amount();
        }
        address broadcaster = vm.addr(pk);
        address proposer = vm.envOr("TIMELOCK_PROPOSER", broadcaster);
        address executor = vm.envOr("TIMELOCK_EXECUTOR", broadcaster);
        if (block.chainid == 1 || block.chainid == 8453 || block.chainid == 42161) revert Amount();

        vm.startBroadcast(pk);

        (address owner, bool safe) = _owner(chain, broadcaster);
        new ZroMainnetGuard().assertReady(block.chainid, address(0), delay, proposer, owner, broadcaster);
        address[] memory proposers = new address[](1);
        proposers[0] = proposer;
        address[] memory executors = new address[](1);
        executors[0] = executor;
        TimelockController timelock = new TimelockController(delay, proposers, executors, owner);

        address endpoint = chain.lzEndpoint;
        if (endpoint == address(0)) endpoint = address(new MockLzEndpoint());
        MockZRO zro = new MockZRO(endpoint, owner, broadcaster);
        zro.mint(broadcaster, zroAmount);
        zro.transferOwnership(owner);

        ZroWeightTracker tracker = new ZroWeightTracker(broadcaster, hookAddr, chain.router, chain.poolManager);
        if (lockerAddr != address(0)) tracker.setExcluded(lockerAddr, true);
        if (launcherAddr != address(0)) tracker.setExcluded(launcherAddr, true);
        tracker.setOwner(owner);

        if (hookAddr != address(0)) {
            LaunchHook hook = LaunchHook(hookAddr);
            ZroRewardVault vault =
                new ZroRewardVault(owner, owner, address(timelock), broadcaster, IERC20(address(zro)), hook, tracker);
            ZroTaxSwapper swapper =
                new ZroTaxSwapper(broadcaster, address(timelock), owner, hook, vault, chain.weth, address(zro));
            vault.setSwapper(address(swapper));
            if (keeper != address(0)) swapper.setKeeper(keeper);
            swapper.setOwner(owner);
            hook.setZroAdmin(owner, address(timelock));
            hook.setZroSwapper(address(swapper));
            if (launcherAddr != address(0)) Launcher(launcherAddr).setZroWeightTracker(address(tracker));
            console2.log("vault", address(vault));
            console2.log("swapper", address(swapper));
        }

        uint256 wethBal = IERC20(chain.weth).balanceOf(broadcaster);
        if (wethBal < wethAmount) IWETH(chain.weth).deposit{value: wethAmount - wethBal}();
        RouteSeeder seeder = new RouteSeeder();
        IERC20(address(zro)).approve(address(seeder), zroAmount);
        IERC20(chain.weth).approve(address(seeder), wethAmount);
        int24 widthSteps = int24(int256(vm.envOr("SEED_WIDTH_STEPS", uint256(1))));
        if (widthSteps < 1) widthSteps = 1;
        (PoolKey memory key, uint256 spent) =
            seeder.seedWide(IPoolManager(chain.poolManager), chain.weth, address(zro), wethAmount, widthSteps);
        if (spent == 0) revert SeedShort();

        vm.stopBroadcast();

        console2.log("owner", owner);
        console2.log("safe", safe ? 1 : 0);
        console2.log("timelock", address(timelock));
        console2.log("timelockDelay", delay);
        console2.log("zro", address(zro));
        console2.log("tracker", address(tracker));
        console2.log("wethSpent", spent);
        console2.log("currency0", Currency.unwrap(key.currency0));
        console2.log("currency1", Currency.unwrap(key.currency1));
    }

    /// @dev 1-of-1 Safe from the canonical factory when that factory has code. Otherwise `TestOwner`.
    function _owner(Addrs memory chain, address broadcaster) internal returns (address owner, bool safe) {
        if (
            chain.safeProxyFactory.code.length > 0 && chain.safeSingleton.code.length > 0
                && chain.safeFallbackHandler.code.length > 0
        ) {
            address[] memory owners = new address[](1);
            owners[0] = broadcaster;
            bytes memory initializer = abi.encodeWithSignature(
                "setup(address[],uint256,address,bytes,address,address,uint256,address)",
                owners,
                uint256(1),
                address(0),
                bytes(""),
                chain.safeFallbackHandler,
                address(0),
                uint256(0),
                address(0)
            );
            owner = ISafeProxyFactory(chain.safeProxyFactory)
                .createProxyWithNonce(
                    chain.safeSingleton, initializer, uint256(keccak256(abi.encode(broadcaster, block.timestamp)))
                );
            return (owner, true);
        }
        return (address(new TestOwner(broadcaster)), false);
    }
}
