// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "../utils/Fixture.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {MockLzEndpoint} from "../../src/zro/MockLzEndpoint.sol";
import {MockZRO} from "../../src/zro/MockZRO.sol";
import {ZroRewardVault} from "../../src/zro/ZroRewardVault.sol";
import {ZroWeightTracker} from "../../src/zro/ZroWeightTracker.sol";

contract ZroVaultTest is Fixture {
    ZroWeightTracker internal tracker;
    ZroRewardVault internal vault;
    MockZRO internal zro;
    address internal coin;
    PoolId internal id;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B2);
    uint64 internal epoch;

    function setUp() public override {
        super.setUp();
        vm.warp(2 days);
        tracker = new ZroWeightTracker(address(this), address(d.hook), address(router), address(pm));
        (coin, id) = _launch(0);
        tracker.registerCoin(coin);
        epoch = uint64(block.timestamp / 1 hours);
        vm.prank(coin);
        tracker.onTransfer(address(0), alice, 2 ether);
        vm.prank(coin);
        tracker.onTransfer(address(0), bob, 1 ether);
        vm.warp(block.timestamp + 1 hours);
        zro = new MockZRO(address(new MockLzEndpoint()), address(this), address(this));
        vault =
            new ZroRewardVault(address(this), address(this), address(d.timelock), address(this), zro, d.hook, tracker);
        vault.setSwapper(address(this));
        zro.mint(address(this), 100 ether);
        zro.approve(address(vault), type(uint256).max);
    }

    function test_pullClaimDustAndConservation() public {
        vault.fund(id, epoch, 10 ether);
        vm.prank(alice);
        uint256 aliceGot = vault.claim(id, epoch);
        vm.prank(bob);
        uint256 bobGot = vault.claim(id, epoch);
        uint256 aliceShare = uint256(20 ether) / 3;
        uint256 bobShare = uint256(10 ether) / 3;
        assertEq(aliceGot, aliceShare);
        assertEq(bobGot, bobShare);
        assertEq(aliceGot + bobGot + 1, 10 ether);
        assertEq(vault.pendingDust(), 1);
        assertEq(vault.totalClaimed(), aliceGot + bobGot);
        assertLe(vault.totalClaimed(), vault.totalFunded());
        assertEq(vault.liabilities() + vault.pendingDust() + vault.totalClaimed(), vault.totalFunded());
        assertEq(zro.balanceOf(address(vault)) + vault.totalClaimed(), vault.totalFunded());
        vm.prank(alice);
        vm.expectRevert();
        vault.claim(id, epoch);
    }

    function test_zeroWeightDoesNotLockTheDeposit() public {
        (, PoolId emptyId) = _launch(0);
        uint64 next = epoch + 2;
        vm.warp(uint256(next + 1) * 1 hours);
        vault.fund(emptyId, next, 4 ether);
        assertEq(vault.pendingDust(), 4 ether);
        assertEq(vault.totalClaimed(), 0);
        assertLe(vault.totalClaimed(), vault.totalFunded());
    }

    function test_ownerCanPauseClaims() public {
        vault.fund(id, epoch, 10 ether);
        vault.pause();
        vm.prank(alice);
        vm.expectRevert(ZroRewardVault.Paused.selector);
        vault.claim(id, epoch);
        vm.prank(alice);
        vm.expectRevert(ZroRewardVault.NotOwner.selector);
        vault.unpause();
        vault.unpause();
        vm.prank(alice);
        assertGt(vault.claim(id, epoch), 0);
    }

    function test_remoteClaimNeedsAModule() public {
        vault.fund(id, epoch, 10 ether);
        vm.prank(alice);
        vm.expectRevert(ZroRewardVault.NoModule.selector);
        vault.claimRemote(id, epoch, 40245, bytes32(uint256(uint160(alice))), "");
    }
}
