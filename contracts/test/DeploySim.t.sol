// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DeploySeedix} from "../script/Deploy.s.sol";
import {SeedixRoles} from "../src/access/SeedixRoles.sol";
import {BuybackExecutor} from "../src/buyback/BuybackExecutor.sol";
import {KickbackDistributor} from "../src/kickback/KickbackDistributor.sol";

contract DeploySimTest is Test {
    function test_anvilDeployerHoldsNoRoles() public {
        uint256 pk = 0xA11CE;
        address deployer = vm.addr(pk);
        address admin = address(0xAD11);
        vm.chainId(31337);
        vm.deal(deployer, 100 ether);

        DeploySeedix script = new DeploySeedix();
        script.deploy(pk, admin, admin);

        (address gotDeployer, address gotAdmin, address timelock, address rolesAddr, address vault,,, address hook,,) =
            script.last();
        assertEq(gotDeployer, deployer);
        assertEq(gotAdmin, admin);
        assertTrue(hook != address(0));

        SeedixRoles roles = SeedixRoles(rolesAddr);
        assertEq(roles.admin(), admin);
        assertEq(roles.guardian(), admin);
        assertTrue(roles.admin() != deployer);
        assertTrue(roles.guardian() != deployer);

        TimelockController tl = TimelockController(payable(timelock));
        assertFalse(tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), deployer));
        assertFalse(tl.hasRole(tl.PROPOSER_ROLE(), deployer));
        assertFalse(tl.hasRole(tl.EXECUTOR_ROLE(), deployer));
        assertFalse(tl.hasRole(tl.CANCELLER_ROLE(), deployer));
        assertTrue(tl.hasRole(tl.PROPOSER_ROLE(), admin));
        assertTrue(tl.hasRole(tl.EXECUTOR_ROLE(), admin));
        assertTrue(tl.hasRole(tl.CANCELLER_ROLE(), admin));
        assertTrue(tl.hasRole(tl.PROPOSER_ROLE(), rolesAddr));
        assertTrue(tl.hasRole(tl.PROPOSER_ROLE(), vault));
        assertEq(tl.getMinDelay(), 48 hours);
    }

    function test_adminKeepsRolesWhenAdminIsDeployer() public {
        uint256 pk = 0xA11CE;
        address deployer = vm.addr(pk);
        vm.chainId(31337);
        vm.deal(deployer, 100 ether);

        DeploySeedix script = new DeploySeedix();
        script.deploy(pk, deployer, deployer);

        (,, address timelock,,,,,,,) = script.last();
        TimelockController tl = TimelockController(payable(timelock));
        assertTrue(tl.hasRole(tl.PROPOSER_ROLE(), deployer), "admin keeps proposer");
        assertTrue(tl.hasRole(tl.EXECUTOR_ROLE(), deployer), "admin keeps executor");
        assertTrue(tl.hasRole(tl.CANCELLER_ROLE(), deployer), "admin keeps canceller");
        assertFalse(tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), deployer), "default admin is still renounced");
    }

    function test_keeperRolesGrantedAtDeploy() public {
        uint256 pk = 0xA11CE;
        address deployer = vm.addr(pk);
        address admin = address(0xAD11);
        address keeper = address(0xBEEF);
        vm.chainId(31337);
        vm.deal(deployer, 100 ether);

        DeploySeedix script = new DeploySeedix();
        script.deploy(pk, admin, admin, keeper);

        (,,,,, address executor, address distributor,,,) = script.last();
        assertEq(BuybackExecutor(executor).keeper(), keeper);
        assertEq(KickbackDistributor(distributor).keeper(), keeper);
        assertTrue(BuybackExecutor(executor).initialKeeperUsed());
        assertTrue(KickbackDistributor(distributor).initialKeeperUsed());

        vm.startPrank(deployer);
        vm.expectRevert();
        BuybackExecutor(executor).grantKeeper(deployer);
        vm.expectRevert();
        KickbackDistributor(distributor).grantKeeper(deployer);
        vm.stopPrank();
    }

    function test_adminDeployerKeepsTimelockWhenKeeperIsSet() public {
        uint256 pk = 0xA11CE;
        address deployer = vm.addr(pk);
        address keeper = address(0xBEEF);
        vm.chainId(31337);
        vm.deal(deployer, 100 ether);

        DeploySeedix script = new DeploySeedix();
        script.deploy(pk, deployer, deployer, keeper);

        (,, address timelock,,, address executor, address distributor,,,) = script.last();
        TimelockController tl = TimelockController(payable(timelock));
        assertTrue(tl.hasRole(tl.PROPOSER_ROLE(), deployer), "admin keeps proposer");
        assertTrue(tl.hasRole(tl.EXECUTOR_ROLE(), deployer), "admin keeps executor");
        assertTrue(tl.hasRole(tl.CANCELLER_ROLE(), deployer), "admin keeps canceller");
        assertFalse(tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), deployer), "default admin is still renounced");
        assertEq(BuybackExecutor(executor).keeper(), keeper);
        assertEq(KickbackDistributor(distributor).keeper(), keeper);
    }
}
