// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {RouteSeeder} from "../../src/launch/RouteSeeder.sol";
import {MockXStock} from "../../src/token/MockXStock.sol";

/// @notice `seedWide` is owner-only and reports the WETH the position actually took.
contract ZroSeedTest is Test {
    function test_seedWidePullsInTheSameCallAndIgnoresAStranger() public {
        PoolManager pm = new PoolManager(address(0));
        MockXStock weth = new MockXStock("WETH", "WETH", 18, address(this));
        MockXStock zro = new MockXStock("ZRO", "ZRO", 18, address(this));
        RouteSeeder seeder = new RouteSeeder();
        weth.approve(address(seeder), type(uint256).max);
        zro.approve(address(seeder), type(uint256).max);

        vm.prank(address(0xBAD));
        vm.expectRevert(RouteSeeder.NotOwner.selector);
        seeder.seedWide(IPoolManager(address(pm)), address(weth), address(zro), 1 ether, 1);

        uint256 beforeWeth = weth.balanceOf(address(this));
        (, uint256 spent) = seeder.seedWide(IPoolManager(address(pm)), address(weth), address(zro), 1 ether, 1);
        assertGt(spent, 0);
        assertLe(spent, 1 ether);
        assertEq(beforeWeth - weth.balanceOf(address(this)), spent);
        assertEq(weth.balanceOf(address(seeder)), 0);
    }
}
