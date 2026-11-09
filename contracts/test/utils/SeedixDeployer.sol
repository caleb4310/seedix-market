// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SeedixRoles} from "../../src/access/SeedixRoles.sol";
import {SeedixConstants as C} from "../../src/libraries/SeedixConstants.sol";
import {HookMiner} from "../../src/libraries/HookMiner.sol";
import {LaunchToken} from "../../src/token/LaunchToken.sol";
import {LaunchHook} from "../../src/hook/LaunchHook.sol";
import {LiquidityLocker} from "../../src/launch/LiquidityLocker.sol";
import {Launcher} from "../../src/launch/Launcher.sol";
import {FeeVault} from "../../src/vault/FeeVault.sol";
import {BuybackExecutor} from "../../src/buyback/BuybackExecutor.sol";
import {KickbackDistributor} from "../../src/kickback/KickbackDistributor.sol";

/// @notice One transaction deploys the Seedix protocol and mines the hook to flags 0x28CC.
///         The guardian role is assigned to `admin`. It can be moved later through the timelock.
contract SeedixDeployer {
    error ForbiddenChain();

    struct Params {
        address admin;
        IPoolManager poolManager;
        uint256 timelockDelay;
        address feeWallet;
        address publisher;
        Currency whype;
        uint256 roundCap;
        uint256 hourlyCap;
        address[] pairs;
    }

    struct Deployed {
        TimelockController timelock;
        SeedixRoles roles;
        LaunchToken implementation;
        FeeVault vault;
        BuybackExecutor executor;
        KickbackDistributor distributor;
        LaunchHook hook;
        LiquidityLocker locker;
        Launcher launcher;
    }

    function deploy(Params memory p) external returns (Deployed memory d) {
        if (block.chainid != 99801 && block.chainid != 31337) revert ForbiddenChain();
        if (p.publisher == address(0)) p.publisher = p.admin;

        address[] memory proposers = new address[](1);
        proposers[0] = p.admin;
        address[] memory executors = new address[](1);
        executors[0] = p.admin;
        d.timelock = new TimelockController(p.timelockDelay, proposers, executors, address(this));
        d.roles = new SeedixRoles(d.timelock, p.admin);

        d.implementation = new LaunchToken();
        d.vault = new FeeVault(d.roles, p.feeWallet, address(this));
        d.executor = new BuybackExecutor(d.roles, p.whype, address(this), 0);
        d.distributor = new KickbackDistributor(d.roles, p.publisher, p.roundCap, p.hourlyCap, address(this));

        d.timelock.grantRole(d.timelock.PROPOSER_ROLE(), address(d.roles));
        d.timelock.grantRole(d.timelock.PROPOSER_ROLE(), address(d.vault));
        d.timelock.renounceRole(d.timelock.DEFAULT_ADMIN_ROLE(), address(this));

        bytes memory args =
            abi.encode(p.poolManager, address(d.vault), address(d.executor), address(d.distributor), address(this));
        (, bytes32 salt) = HookMiner.find(address(this), C.HOOK_FLAGS, type(LaunchHook).creationCode, args);
        d.hook = new LaunchHook{salt: salt}(
            p.poolManager, address(d.vault), address(d.executor), address(d.distributor), address(this)
        );

        d.locker = new LiquidityLocker(p.poolManager, address(this));
        d.launcher = new Launcher(
            d.roles, p.poolManager, d.hook, d.locker, d.implementation, d.executor, address(this), p.pairs
        );

        d.hook.setLauncher(address(d.launcher));
        d.hook.setLocker(address(d.locker));
        d.vault.setHook(d.hook);
        d.executor.wire(d.hook, address(d.launcher), address(d.locker));
        d.locker.wire(d.hook, address(d.launcher), address(d.executor));
        d.distributor.wire(d.hook, address(p.poolManager), address(d.locker), address(d.vault), address(d.executor));
    }
}
