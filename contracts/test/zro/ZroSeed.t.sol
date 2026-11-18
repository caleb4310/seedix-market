// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {RouteSeeder} from "../../src/launch/RouteSeeder.sol";
import {MockXStock} from "../../src/token/MockXStock.sol";

/// @notice `seedWide` reports WETH spent only from the seeder's own balance. An approval pays the
///         pool from the caller and the reported spend stays zero, which is the SeedShort revert.
contract ZroSeedTest is Test {
    function test_seedWideSpendIsZeroUntilTheSeederIsPrefunded() public {
        PoolManager pm = new PoolManager(address(0));
        MockXStock weth = new MockXStock("WETH", "WETH", 18, address(this));
        MockXStock approvedOnly = new MockXStock("ZRO", "ZRO", 18, address(this));

        RouteSeeder bare = new RouteSeeder();
        weth.approve(address(bare), type(uint256).max);
        approvedOnly.approve(address(bare), type(uint256).max);
        (, uint256 bareSpent) =
            bare.seedWide(IPoolManager(address(pm)), address(weth), address(approvedOnly), 1 ether, 1);
        assertEq(bareSpent, 0);

        MockXStock prefunded = new MockXStock("ZRO2", "ZRO2", 18, address(this));
        RouteSeeder funded = new RouteSeeder();
        weth.approve(address(funded), type(uint256).max);
        prefunded.approve(address(funded), type(uint256).max);
        weth.transfer(address(funded), 1 ether);
        prefunded.transfer(address(funded), 1 ether);
        (, uint256 spent) = funded.seedWide(IPoolManager(address(pm)), address(weth), address(prefunded), 1 ether, 1);
        assertGt(spent, 0);
        assertLe(spent, 1 ether);
    }
}
