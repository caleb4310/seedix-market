// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {SeedixRouter} from "../src/router/SeedixRouter.sol";

contract RouterTest is Fixture {
    using StateLibrary for IPoolManager;

    PoolId internal id;

    function setUp() public override {
        super.setUp();
        (, id) = _launch(0);
    }

    function swapPartial(PoolKey calldata key, bool zeroForOne, uint160 limit) external returns (int128 paid) {
        BalanceDelta delta = router.swap(key, zeroForOne, -50 ether, 0, block.timestamp, limit);
        int128 inn = zeroForOne ? delta.amount0() : delta.amount1();
        paid = inn;
    }

    function test_rejectsUnlimitedPriceAndExpiredDeadline() public {
        PoolKey memory key = _key(id);
        vm.expectRevert(SeedixRouter.PriceLimit.selector);
        router.swap(key, true, -1 ether, 0, block.timestamp, 0);
        vm.expectRevert(SeedixRouter.Expired.selector);
        router.swap(key, true, -1 ether, 0, block.timestamp - 1, TickMath.MIN_SQRT_PRICE + 1);
    }

    function test_exactInPartialFillRevertsAndDoesNotKeepTheFee() public {
        (,, bool coinIsToken0,,,,) = d.hook.config(id);
        bool zeroForOne = !coinIsToken0;
        (uint160 sqrt,,,) = IPoolManager(address(pm)).getSlot0(id);
        uint160 limit = zeroForOne ? sqrt - 1 : sqrt + 1;
        (,,,, uint128 burnCoin) = d.hook.pots(id);
        try this.swapPartial(_key(id), zeroForOne, limit) returns (int128) {
            revert("partial exact-in settled");
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), SeedixRouter.PartialFill.selector);
        }
        (,,,, uint128 burnCoinAfter) = d.hook.pots(id);
        assertEq(burnCoinAfter, burnCoin);
        _buy(id, 1 ether);
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
