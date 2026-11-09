// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SeedixRouter} from "../src/router/SeedixRouter.sol";

contract RouterTest is Fixture {
    PoolId internal id;

    function setUp() public override {
        super.setUp();
        (, id) = _launch(0);
    }

    function test_rejectsUnlimitedPriceAndExpiredDeadline() public {
        PoolKey memory key = _key(id);
        vm.expectRevert(SeedixRouter.PriceLimit.selector);
        router.swap(key, true, -1 ether, 0, block.timestamp, 0);
        vm.expectRevert(SeedixRouter.Expired.selector);
        router.swap(key, true, -1 ether, 0, block.timestamp - 1, TickMath.MIN_SQRT_PRICE + 1);
    }

    function test_minOutIsEnforced() public {
        (,, bool coinIsToken0,,,,) = d.hook.config(id);
        bool zeroForOne = !coinIsToken0;
        PoolKey memory key = _key(id);
        vm.expectRevert(SeedixRouter.TooLittleReceived.selector);
        router.swap(key, zeroForOne, -1 ether, type(uint128).max, block.timestamp, _lim(zeroForOne));
        _buy(id, 1 ether);
    }
}
