// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "../utils/Fixture.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {RouteSeeder} from "../../src/launch/RouteSeeder.sol";
import {MockLzEndpoint} from "../../src/zro/MockLzEndpoint.sol";
import {MockZRO} from "../../src/zro/MockZRO.sol";
import {ZroFeeMath} from "../../src/zro/ZroFeeMath.sol";
import {ZroRewardVault} from "../../src/zro/ZroRewardVault.sol";
import {ZroTaxSwapper} from "../../src/zro/ZroTaxSwapper.sol";
import {ZroWeightTracker} from "../../src/zro/ZroWeightTracker.sol";

/// @notice Local Uniswap v4 pool. The tax is escrowed by the hook, then harvested outside the swap.
contract ZroSwapTest is Fixture {
    function test_creatorTaxSwapsToZroOutsideTheHook() public {
        vm.warp(2 days);
        ZroWeightTracker tracker = new ZroWeightTracker(address(this), address(d.hook), address(router), address(pm));
        tracker.setExcluded(address(d.locker), true);
        tracker.setExcluded(address(d.launcher), true);
        deployer.setWeightTracker(d.launcher, address(tracker));
        deployer.setZroAdmin(d.hook, admin, address(d.timelock));

        MockZRO zro = new MockZRO(address(new MockLzEndpoint()), address(this), address(this));
        ZroRewardVault vault =
            new ZroRewardVault(address(this), address(this), address(d.timelock), address(this), zro, d.hook, tracker);
        ZroTaxSwapper swapper =
            new ZroTaxSwapper(address(this), address(d.timelock), admin, d.hook, vault, address(whype), address(zro));
        deployer.setZroSwapper(d.hook, address(swapper));
        vault.setSwapper(address(swapper));
        swapper.setKeeper(address(this));

        (, PoolId id) = d.launcher.launchWithZroTax(_params(address(whype), 0, 0, address(0)), 500);
        (,,, uint8 mode, uint16 effectiveBps) = d.hook.zroTax(id);
        assertEq(mode, ZroFeeMath.ON_TOP);
        assertEq(effectiveBps, 600);
        _buy(id, 100 ether);
        assertEq(d.hook.zroHolderPot(id), 5 ether);
        assertEq(d.hook.zroProtocolPot(id), 1 ether);

        zro.mint(address(this), 2_000_000 ether);
        whype.mint(address(this), 2_000_000 ether);
        RouteSeeder seeder = new RouteSeeder();
        zro.approve(address(seeder), type(uint256).max);
        whype.approve(address(seeder), type(uint256).max);
        (PoolKey memory key,) = seeder.seedWide(pm, address(whype), address(zro), 5_000 ether, 8);
        swapper.registerPool(key);

        vm.expectRevert();
        swapper.harvest(id, 1);

        uint256 opened = vm.getBlockTimestamp();
        swapper.poke();
        vm.warp(opened + 31 minutes);
        swapper.poke();
        vm.warp(vm.getBlockTimestamp() + 31 minutes);
        uint256 hourEnd = (vm.getBlockTimestamp() / 1 hours + 1) * 1 hours;
        vm.warp(hourEnd);
        swapper.poke();
        (uint256 holderIn,,) = swapper.nextHolderIn(id);
        (, uint256 floor,,) = swapper.quote(holderIn);
        uint256 out = swapper.harvest(id, floor);
        assertGt(out, 0);
        assertEq(zro.balanceOf(address(vault)), out);
        assertEq(whype.balanceOf(admin), 1 ether);
        assertEq(d.hook.zroHolderPot(id), 0);
        assertLe(vault.totalClaimed(), vault.totalFunded());

        _buy(id, 100 ether);
        assertGt(d.hook.zroHolderPot(id), 0);
        swapper.poke();
        vm.warp(block.timestamp + 31 minutes);
        swapper.poke();
        vm.warp((block.timestamp / 1 hours + 1) * 1 hours);
        vm.expectRevert(ZroTaxSwapper.Slippage.selector);
        swapper.harvest(id, 1);
    }

    function test_lateHarvestSplitsEachMissedRound() public {
        (ZroTaxSwapper swapper, ZroRewardVault vault, PoolId id) = _boot();
        uint64 start = uint64(vm.getBlockTimestamp() / 1 hours);
        for (uint256 i; i < 3; ++i) {
            _buy(id, 20 ether);
            vm.warp(vm.getBlockTimestamp() + 1 hours);
        }
        swapper.poke();
        (uint256 holderIn, uint64 from, uint64 to) = swapper.nextHolderIn(id);
        assertEq(from, start);
        assertEq(to, start + 2);
        (, uint256 floor,,) = swapper.quote(holderIn);
        uint256 out = swapper.harvest(id, floor);
        assertGt(out, 0);
        uint256 fundedSum;
        for (uint64 epoch = start; epoch < start + 3; ++epoch) {
            (uint128 funded,,,,,,) = vault.rounds(vault.roundId(id, epoch));
            assertGt(funded, 0);
            fundedSum += funded;
            assertGt(vault.claim(id, epoch), 0);
        }
        assertEq(fundedSum, out);
        assertEq(d.hook.zroHolderPot(id), 0);
        assertLe(vault.totalClaimed(), vault.totalFunded());
        assertEq(vault.liabilities() + vault.pendingDust() + vault.totalClaimed(), vault.totalFunded());
    }

    function test_harvestContinuesAfterTheRoundCap() public {
        (ZroTaxSwapper swapper, ZroRewardVault vault, PoolId id) = _boot();
        uint64 start = uint64(vm.getBlockTimestamp() / 1 hours);
        uint256 rounds = 8 + 2;
        for (uint256 i; i < rounds; ++i) {
            _buy(id, 10 ether);
            vm.warp(vm.getBlockTimestamp() + 1 hours);
        }
        swapper.poke();
        (uint256 firstIn, uint64 from, uint64 to) = swapper.nextHolderIn(id);
        assertEq(from, start);
        assertEq(uint256(to - from) + 1, 8);
        (, uint256 floor,,) = swapper.quote(firstIn);
        uint256 firstOut = swapper.harvest(id, floor);
        assertGt(firstOut, 0);
        assertEq(swapper.nextHarvestEpoch(id), from + 8);
        assertGt(d.hook.zroHolderPot(id), 0);

        (uint256 secondIn,,) = swapper.nextHolderIn(id);
        (, uint256 floor2,,) = swapper.quote(secondIn);
        uint256 secondOut = swapper.harvest(id, floor2);
        assertGt(secondOut, 0);
        assertEq(d.hook.zroHolderPot(id), 0);
        assertGt(vault.claim(id, from), 0);
        assertGt(vault.claim(id, from + 8), 0);
        assertLe(vault.totalClaimed(), vault.totalFunded());
        assertEq(vault.liabilities() + vault.pendingDust() + vault.totalClaimed(), vault.totalFunded());
        assertEq(vault.totalFunded(), firstOut + secondOut);
    }

    function _boot() internal returns (ZroTaxSwapper swapper, ZroRewardVault vault, PoolId id) {
        vm.warp(2 days);
        ZroWeightTracker tracker = new ZroWeightTracker(address(this), address(d.hook), address(router), address(pm));
        tracker.setExcluded(address(d.locker), true);
        tracker.setExcluded(address(d.launcher), true);
        deployer.setWeightTracker(d.launcher, address(tracker));
        deployer.setZroAdmin(d.hook, admin, address(d.timelock));
        MockZRO zro = new MockZRO(address(new MockLzEndpoint()), address(this), address(this));
        vault =
            new ZroRewardVault(address(this), address(this), address(d.timelock), address(this), zro, d.hook, tracker);
        swapper =
            new ZroTaxSwapper(address(this), address(d.timelock), admin, d.hook, vault, address(whype), address(zro));
        deployer.setZroSwapper(d.hook, address(swapper));
        vault.setSwapper(address(swapper));
        swapper.setKeeper(address(this));
        (, id) = d.launcher.launchWithZroTax(_params(address(whype), 0, 0, address(0)), 500);
        zro.mint(address(this), 2_000_000 ether);
        whype.mint(address(this), 2_000_000 ether);
        RouteSeeder seeder = new RouteSeeder();
        zro.approve(address(seeder), type(uint256).max);
        whype.approve(address(seeder), type(uint256).max);
        (PoolKey memory key,) = seeder.seedWide(pm, address(whype), address(zro), 5_000 ether, 8);
        swapper.registerPool(key);
        uint256 opened = vm.getBlockTimestamp();
        swapper.poke();
        vm.warp(opened + 31 minutes);
        swapper.poke();
    }
}
