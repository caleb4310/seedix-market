// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {DeploySeedix} from "../script/Deploy.s.sol";
import {SeedixRoles} from "../src/access/SeedixRoles.sol";

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
        assertTrue(tl.hasRole(tl.PROPOSER_ROLE(), admin));
        assertTrue(tl.hasRole(tl.EXECUTOR_ROLE(), admin));
        assertTrue(tl.hasRole(tl.PROPOSER_ROLE(), rolesAddr));
        assertTrue(tl.hasRole(tl.PROPOSER_ROLE(), vault));
        assertEq(tl.getMinDelay(), 48 hours);
    }
}
