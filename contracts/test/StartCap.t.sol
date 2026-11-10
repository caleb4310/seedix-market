// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";
import {LaunchCurve} from "../src/libraries/LaunchCurve.sol";
import {Launcher} from "../src/launch/Launcher.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Fixture} from "./utils/Fixture.sol";

/// @notice The default start is 34 WHYPE, about $2,500 at $74.6 per HYPE.
contract StartCapTest is Fixture {
    function test_defaultIsThirtyFourWhype() public view {
        assertEq(d.launcher.startMcap(), 34 ether);
    }

    function test_onlyTimelockSetsTheCap() public {
        vm.expectRevert(Launcher.NotTimelock.selector);
        d.launcher.setStartMcap(40 ether);
        vm.prank(creator);
        vm.expectRevert(Launcher.NotTimelock.selector);
        d.launcher.setStartMcap(40 ether);
        vm.prank(address(d.roles.timelock()));
        vm.expectRevert(Launcher.BadArgs.selector);
        d.launcher.setStartMcap(0);
        vm.prank(address(d.roles.timelock()));
        d.launcher.setStartMcap(40 ether);
        assertEq(d.launcher.startMcap(), 40 ether);
    }

    function test_planAtDefaultCapStaysOnATick(bool coinIsToken0) public view {
        uint256 cap = d.launcher.startMcap();
        LaunchCurve.Plan memory full = LaunchCurve.plan(coinIsToken0, cap, C.SUPPLY);
        _bounds(full);
        uint256 team = C.SUPPLY * C.MAX_TEAM_BPS / 10_000;
        LaunchCurve.Plan memory shared = LaunchCurve.plan(coinIsToken0, cap, C.SUPPLY - team);
        _bounds(shared);
    }

    function test_firstBuyAtTheDefaultCap() public {
        Launcher.LaunchParams memory params = _params(address(whype), 0, 0, address(0));
        params.startMcapInPair = d.launcher.startMcap();
        (address coin, PoolId id) = d.launcher.launch(params);
        int24 tick = _spot(id);
        assertEq(tick % C.TICK_SPACING, 0);
        assertGt(tick, TickMath.minUsableTick(C.TICK_SPACING));
        assertLt(tick, TickMath.maxUsableTick(C.TICK_SPACING));
        whype.mint(address(this), 1 ether);
        uint256 beforeBal = IERC20(coin).balanceOf(address(this));
        int128 got = _buy(id, 0.01 ether);
        assertGt(got, 0);
        assertGt(IERC20(coin).balanceOf(address(this)), beforeBal);
        assertEq(IERC20(coin).balanceOf(address(router)), 0);
        assertEq(whype.balanceOf(address(router)), 0);

        uint256 mid = IERC20(coin).balanceOf(address(this));
        _buy(id, 1 ether);
        assertGt(IERC20(coin).balanceOf(address(this)), mid);
        assertEq(IERC20(coin).balanceOf(address(router)), 0);
        assertEq(whype.balanceOf(address(router)), 0);
        assertEq(C.START_FEE, 800_000);
        assertEq(C.END_FEE, 10_000);
        assertEq(C.PLATFORM_FEE, 10_000);
    }

    function _bounds(LaunchCurve.Plan memory plan) internal pure {
        assertEq(plan.tick % C.TICK_SPACING, 0);
        assertGt(plan.tick, TickMath.minUsableTick(C.TICK_SPACING));
        assertLt(plan.tick, TickMath.maxUsableTick(C.TICK_SPACING));
        assertEq(plan.sqrtPriceX96, TickMath.getSqrtPriceAtTick(plan.tick));
        assertGt(plan.near.liquidity, 0);
        assertEq(plan.near.lower % C.TICK_SPACING, 0);
        assertEq(plan.near.upper % C.TICK_SPACING, 0);
        if (plan.far.liquidity > 0) {
            assertLt(plan.far.lower, plan.far.upper);
        }
    }
}
