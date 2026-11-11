// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";
import {SeedixRoles} from "../src/access/SeedixRoles.sol";
import {BuybackExecutor} from "../src/buyback/BuybackExecutor.sol";
import {DeploySeedix} from "../script/Deploy.s.sol";
import {Launcher} from "../src/launch/Launcher.sol";
import {Fixture} from "./utils/Fixture.sol";

contract MainnetGuardTest is Test {
    function _roles() internal returns (SeedixRoles roles) {
        address[] memory one = new address[](1);
        one[0] = address(this);
        TimelockController tl = new TimelockController(48 hours, one, one, address(this));
        roles = new SeedixRoles(tl, address(this));
    }

    function test_testnetMayUseZeroKeeperDelay() public {
        BuybackExecutor ex = new BuybackExecutor(_roles(), Currency.wrap(address(1)), address(this), 0, 0);
        ex.setKeeper(address(0xBEEF));
        assertEq(ex.keeper(), address(0xBEEF));
    }

    function test_mainnetKeeperDelayIsFortyEightHours() public {
        vm.chainId(99901);
        SeedixRoles roles = _roles();
        vm.expectRevert(abi.encodeWithSelector(BuybackExecutor.KeeperDelayTooShort.selector, 0, 48 hours));
        new BuybackExecutor(roles, Currency.wrap(address(1)), address(this), 0, 0);

        BuybackExecutor ex = new BuybackExecutor(roles, Currency.wrap(address(1)), address(this), 0, 48 hours);
        vm.expectRevert(BuybackExecutor.ImmediateKeeperDisabled.selector);
        ex.setKeeper(address(0xBEEF));
        ex.proposeKeeper(address(0xBEEF));
        vm.warp(block.timestamp + 48 hours - 1);
        vm.expectRevert(BuybackExecutor.TooSoon.selector);
        ex.applyKeeper();
        vm.warp(block.timestamp + 1);
        ex.applyKeeper();
        assertEq(ex.keeper(), address(0xBEEF));
    }

    function test_mainnetAdminCannotBeTheFeeWallet() public {
        DeploySeedix script = new DeploySeedix();
        vm.chainId(99901);
        vm.expectRevert(abi.encodeWithSelector(DeploySeedix.AdminIsFeeWallet.selector, C.FEE_WALLET));
        script.requireMainnetAdmin(C.FEE_WALLET);
        uint256 delay = script.requireMainnetAdmin(address(0xA11CE));
        assertEq(delay, 48 hours);
    }
}

contract KickbackMainnetTest is Fixture {
    function test_kickbackLaunchRevertsOffTestnet() public {
        vm.chainId(99901);
        vm.expectRevert(Launcher.KickbackDisabled.selector);
        d.launcher.launch(_params(address(whype), 1, 0, address(0)));
    }
}
