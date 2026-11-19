// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "../utils/Fixture.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {RouteSeeder} from "../../src/launch/RouteSeeder.sol";
import {MockLzEndpoint} from "../../src/zro/MockLzEndpoint.sol";
import {MockZRO} from "../../src/zro/MockZRO.sol";
import {ZroRewardVault} from "../../src/zro/ZroRewardVault.sol";
import {ZroTaxSwapper} from "../../src/zro/ZroTaxSwapper.sol";
import {ZroWeightTracker} from "../../src/zro/ZroWeightTracker.sol";

contract RecheckOracle is Fixture {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    MockZRO zro;
    PoolKey key;
    ZroTaxSwapper swapper;
    PoolId id;

    function setUp() public override {
        super.setUp();
        _boot();
        _buy(id, 100 ether);
    }

    function _wethIs0() internal view returns (bool) {
        return Currency.unwrap(key.currency0) == address(whype);
    }

    function _spot() internal view returns (int24 t) {
        (, t,,) = IPoolManager(address(pm)).getSlot0(key.toId());
    }

    /// M-05: a quiet gap plus one poke no longer quotes that gap as the live tick.
    function test_R_M05_quietGapNowRefused() public {
        vm.warp((vm.getBlockTimestamp() / 1 hours + 1) * 1 hours + 40 minutes);
        (uint256 holderIn,,) = swapper.nextHolderIn(id);
        router.swap(
            key,
            _wethIs0(),
            -int256(1_000_000 ether),
            0,
            block.timestamp,
            TickMath.getSqrtPriceAtTick(_wethIs0() ? int24(-400) : int24(400))
        );
        swapper.poke();
        vm.expectRevert();
        swapper.quote(holderIn);
        vm.expectRevert();
        swapper.harvest(id, 1);
    }

    /// The keeper, poking every 30 seconds, restores a quiet pool. A stranger cannot poke.
    function test_R_M05_livenessAfterDensePokes() public {
        vm.warp((vm.getBlockTimestamp() / 1 hours + 1) * 1 hours + 40 minutes);
        vm.prank(address(0xA77AC));
        vm.expectRevert(ZroTaxSwapper.NotKeeper.selector);
        swapper.poke();
        _densePokes(64, 30, false, 0);
        (uint256 holderIn,,) = swapper.nextHolderIn(id);
        (, uint256 floor,,) = swapper.quote(holderIn);
        assertGt(swapper.harvest(id, floor), 0);
    }

    /// A keeper on a 40 second cadence still leaves part of each interval without a fresh observation.
    function test_R_info_spacing40sTimingSensitive() public {
        vm.warp((vm.getBlockTimestamp() / 1 hours + 1) * 1 hours + 40 minutes);
        _densePokes(60, 40, false, 0);
        swapper.quote(1 ether);
        vm.warp(vm.getBlockTimestamp() + 32);
        vm.expectRevert();
        swapper.quote(1 ether);
    }

    /// The shifted tick is no longer recorded: poke is the keeper's call. Spot can move and come
    /// back in one block, and the harvest still uses the keeper's observations.
    function test_R_NEW_sandwichPokeShiftsDenseTwap() public {
        vm.warp((vm.getBlockTimestamp() / 1 hours + 1) * 1 hours + 40 minutes);
        int24 honest = _spot();
        _densePokes(64, 30, true, 400);
        int24 dd = _spot() - honest;
        assertLe(dd < 0 ? -dd : dd, 1);
        (uint256 holderIn,,) = swapper.nextHolderIn(id);
        (, uint256 floor,,) = swapper.quote(holderIn);
        assertGt(swapper.harvest(id, floor), 0);
    }

    function _densePokes(uint256 n, uint256 step, bool attack, int24 shift) internal {
        for (uint256 i; i < n; ++i) {
            vm.warp(vm.getBlockTimestamp() + step);
            swapper.poke();
            if (attack) {
                bool z = _wethIs0();
                int24 h = _spot();
                int24 to = z ? -shift : shift;
                router.swap(key, z, -int256(1_000_000 ether), 0, block.timestamp, TickMath.getSqrtPriceAtTick(to));
                vm.prank(address(0xA77AC));
                vm.expectRevert(ZroTaxSwapper.NotKeeper.selector);
                swapper.poke();
                router.swap(key, !z, -int256(1_000_000 ether), 0, block.timestamp, TickMath.getSqrtPriceAtTick(h));
            }
        }
    }

    function _boot() internal {
        vm.warp(2 days);
        ZroWeightTracker tracker = new ZroWeightTracker(address(this), address(d.hook), address(router), address(pm));
        tracker.setLauncher(address(d.launcher));
        tracker.setExcluded(address(d.locker), true);
        tracker.setExcluded(address(d.launcher), true);
        deployer.setWeightTracker(d.launcher, address(tracker));
        deployer.setZroAdmin(d.hook, admin, address(d.timelock));
        zro = new MockZRO(address(new MockLzEndpoint()), address(this), address(this));
        ZroRewardVault vault =
            new ZroRewardVault(address(this), address(this), address(d.timelock), address(this), zro, d.hook, tracker);
        swapper =
            new ZroTaxSwapper(address(this), address(d.timelock), admin, d.hook, vault, address(whype), address(zro));
        deployer.setZroSwapper(d.hook, address(swapper));
        vault.setSwapper(address(swapper));
        vm.prank(address(d.timelock));
        swapper.setKeeper(address(this));
        (, id) = d.launcher.launchWithZroTax(_params(address(whype), 0, 0, address(0)), 500);
        zro.mint(address(this), 2_000_000 ether);
        whype.mint(address(this), 2_000_000 ether);
        RouteSeeder seeder = new RouteSeeder();
        zro.approve(address(seeder), type(uint256).max);
        whype.approve(address(seeder), type(uint256).max);
        zro.approve(address(router), type(uint256).max);
        (key,) = seeder.seedWide(pm, address(whype), address(zro), 5_000 ether, 8);
        swapper.registerPool(key);
        swapper.poke();
    }
}
