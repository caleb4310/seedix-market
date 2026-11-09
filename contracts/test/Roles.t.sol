// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";
import {TwapGuard} from "../src/libraries/TwapGuard.sol";

contract RolesTest is Fixture {
    function test_guardianIsAdminAndCanPauseBuybacks() public view {
        assertEq(d.roles.guardian(), admin);
        assertEq(d.roles.admin(), admin);
    }

    function test_pauseBuybacksIsInstantAndNotAFeeChange() public {
        vm.prank(admin);
        d.executor.pause();
        assertTrue(d.executor.buybacksPaused());
        vm.prank(address(0x55));
        vm.expectRevert();
        d.executor.pause();
        address walletBefore = d.vault.feeWallet();
        vm.prank(admin);
        vm.expectRevert();
        d.vault.setFeeWallet(address(0x1234));
        assertEq(d.vault.feeWallet(), walletBefore);
    }

    function test_feeWalletTakes48Hours() public {
        address next = address(0x123456);
        vm.prank(admin);
        d.vault.queueFeeWallet(next);
        bytes memory data = abi.encodeCall(d.vault.setFeeWallet, (next));
        TimelockController tl = d.roles.timelock();
        vm.prank(admin);
        vm.expectRevert();
        tl.execute(address(d.vault), 0, data, bytes32(0), bytes32(uint256(2)));
        vm.warp(block.timestamp + 48 hours);
        vm.prank(admin);
        tl.execute(address(d.vault), 0, data, bytes32(0), bytes32(uint256(2)));
        assertEq(d.vault.feeWallet(), next);
    }

    function test_splitGuardianThroughTimelock() public {
        address next = address(0x6A2D);
        vm.prank(admin);
        d.roles.queueSetGuardian(next);
        bytes memory data = abi.encodeCall(d.roles.setGuardian, (next));
        TimelockController tl = d.roles.timelock();
        vm.warp(block.timestamp + 48 hours);
        vm.prank(admin);
        tl.execute(address(d.roles), 0, data, bytes32(0), bytes32(uint256(1)));
        assertEq(d.roles.guardian(), next);
        vm.prank(admin);
        vm.expectRevert();
        d.launcher.pause();
        vm.prank(next);
        d.launcher.pause();
        assertTrue(d.launcher.launchesPaused());
        vm.prank(next);
        vm.expectRevert();
        d.vault.queueFeeWallet(address(0x999));
    }

    function test_bandAndMinOutFloor() public {
        BandProbe probe = new BandProbe();
        vm.expectRevert(abi.encodeWithSelector(TwapGuard.SpotOutsideBand.selector, int24(300), int24(0)));
        probe.check(300, 0);
        probe.check(100, 0);
        assertEq(TwapGuard.effectiveMin(10, 3), 10);
        assertEq(TwapGuard.effectiveMin(10, 40), 40);
    }
}

contract BandProbe {
    function check(int24 spot, int24 twap) external pure {
        TwapGuard.assertBand(spot, twap);
    }
}
