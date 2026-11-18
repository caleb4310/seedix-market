// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";
import {LaunchToken} from "../src/token/LaunchToken.sol";
import {LaunchHook} from "../src/hook/LaunchHook.sol";
import {LiquidityLocker} from "../src/launch/LiquidityLocker.sol";
import {Launcher} from "../src/launch/Launcher.sol";
import {CoinMetadata} from "../src/launch/CoinMetadata.sol";
import {FeeVault} from "../src/vault/FeeVault.sol";
import {BuybackExecutor} from "../src/buyback/BuybackExecutor.sol";
import {KickbackDistributor} from "../src/kickback/KickbackDistributor.sol";
import {SeedixRoles} from "../src/access/SeedixRoles.sol";
import {SeedixRouter} from "../src/router/SeedixRouter.sol";
import {ZroChain} from "./ZroChain.sol";

/// @notice Base Sepolia Seedix launch stack. Uses the official Uniswap v4 PoolManager and WETH
///         from config. Does not seed backing routes and does not touch Elysium. The deployer
///         stays the hook/launcher/locker initializer so DeployBaseSepoliaZro can wire ZRO.
///         PRIVATE_KEY is never logged. Deploy.s.sol still refuses chain 84532.
contract DeployBaseSepoliaSeedix is ZroChain {
    error ForbiddenChain(uint256 chainId);

    /// @dev Arachnid CREATE2 deployer. `new {salt}` in a Forge script comes from this address.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        if (block.chainid != 84532) revert ForbiddenChain(block.chainid);
        Addrs memory chain = _load();
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address admin = vm.envOr("ADMIN", deployer);
        address publisher = vm.envOr("KICKBACK_PUBLISHER", admin);
        address keeper = vm.envOr("KEEPER", address(0));
        address feeWallet = vm.envOr("FEE_WALLET", deployer);
        uint256 delay = vm.envOr("TIMELOCK_DELAY", uint256(60));
        if (delay == 0) delay = 60;

        vm.startBroadcast(pk);

        IPoolManager manager = IPoolManager(chain.poolManager);
        SeedixRouter router = new SeedixRouter(manager);

        uint256 n = vm.getNonce(deployer);
        address vaultA = vm.computeCreateAddress(deployer, n + 3);
        address execA = vm.computeCreateAddress(deployer, n + 4);
        address distA = vm.computeCreateAddress(deployer, n + 5);
        (, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            C.HOOK_FLAGS,
            type(LaunchHook).creationCode,
            abi.encode(manager, vaultA, execA, distA, deployer)
        );

        address[] memory proposers = new address[](1);
        proposers[0] = deployer;
        address[] memory executors = new address[](1);
        executors[0] = deployer;
        TimelockController tl = new TimelockController(delay, proposers, executors, deployer);
        SeedixRoles roles = new SeedixRoles(tl, admin);
        LaunchToken impl = new LaunchToken();
        FeeVault vault = new FeeVault(roles, feeWallet, deployer);
        BuybackExecutor executor = new BuybackExecutor(roles, Currency.wrap(chain.weth), deployer, 0, 48 hours);
        KickbackDistributor distributor =
            new KickbackDistributor(roles, publisher, 1_000_000 ether, 10_000_000 ether, deployer);
        require(address(vault) == vaultA && address(executor) == execA && address(distributor) == distA, "nonce");

        tl.grantRole(tl.PROPOSER_ROLE(), admin);
        tl.grantRole(tl.EXECUTOR_ROLE(), admin);
        tl.grantRole(tl.CANCELLER_ROLE(), admin);
        tl.grantRole(tl.PROPOSER_ROLE(), address(roles));
        tl.grantRole(tl.PROPOSER_ROLE(), address(vault));
        if (admin != deployer) {
            tl.renounceRole(tl.PROPOSER_ROLE(), deployer);
            tl.renounceRole(tl.EXECUTOR_ROLE(), deployer);
            tl.renounceRole(tl.CANCELLER_ROLE(), deployer);
        }
        tl.renounceRole(tl.DEFAULT_ADMIN_ROLE(), deployer);

        LaunchHook hook =
            new LaunchHook{salt: salt}(manager, address(vault), address(executor), address(distributor), deployer);
        require(uint160(address(hook)) & ((1 << 14) - 1) == C.HOOK_FLAGS, "flags");

        address[] memory pairs = new address[](1);
        pairs[0] = chain.weth;
        LiquidityLocker locker = new LiquidityLocker(manager, deployer);
        Launcher launcher = new Launcher(roles, manager, hook, locker, impl, executor, deployer, pairs);
        hook.setLauncher(address(launcher));
        hook.setLocker(address(locker));
        vault.setHook(hook);
        executor.wire(hook, address(launcher), address(locker));
        locker.wire(hook, address(launcher), address(executor));
        distributor.wire(hook, address(manager), address(locker), address(vault), address(executor));
        executor.grantKeeper(keeper);
        distributor.grantKeeper(keeper);
        CoinMetadata meta = new CoinMetadata(launcher);

        vm.stopBroadcast();

        console2.log("deployer", deployer);
        console2.log("admin", admin);
        console2.log("feeWallet", feeWallet);
        console2.log("timelock", address(tl));
        console2.log("timelockDelay", delay);
        console2.log("roles", address(roles));
        console2.log("implementation", address(impl));
        console2.log("vault", address(vault));
        console2.log("executor", address(executor));
        console2.log("distributor", address(distributor));
        console2.log("hook", address(hook));
        console2.log("launcher", address(launcher));
        console2.log("locker", address(locker));
        console2.log("router", address(router));
        console2.log("metadata", address(meta));
        console2.log("poolManager", chain.poolManager);
        console2.log("weth", chain.weth);
        console2.log("hook hash");
        console2.logBytes32(address(hook).codehash);
    }
}
