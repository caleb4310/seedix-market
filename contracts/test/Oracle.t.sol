// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {OracleLib} from "../src/libraries/OracleLib.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";
import {BuybackExecutor} from "../src/buyback/BuybackExecutor.sol";

contract OracleTest is Fixture {
    PoolId internal id;

    function setUp() public override {
        super.setUp();
        (, id) = _launch(0);
    }

    function test_oneWritePerCadence() public {
        assertEq(d.hook.observationCount(id), 1);
        for (uint256 i; i < 15; ++i) {
            _buy(id, 0.01 ether);
        }
        assertEq(d.hook.observationCount(id), 1, "same timestamp must not append");
        vm.warp(block.timestamp + C.OBS_CADENCE);
        _buy(id, 0.01 ether);
        assertEq(d.hook.observationCount(id), 2);
    }

    function test_buybackNeedsTheWindow() public {
        vm.expectRevert(BuybackExecutor.YoungPool.selector);
        d.executor.buybackCoin(id, 1 ether, 1);
        vm.warp(block.timestamp + C.TWAP_WINDOW);
        try d.executor.buybackCoin(id, 1 ether, 1) returns (uint256) {
            revert("expected deferral");
        } catch (bytes memory data) {
            assertEq(bytes4(data), BuybackExecutor.BuybackSwapDeferred.selector);
        }
        vm.prank(admin);
        d.launcher.launchPlatformToken(_params(address(whype), 0, 0, address(0)));
        vm.expectRevert(BuybackExecutor.RouteNotRegistered.selector);
        d.executor.buybackPlatform(Currency.wrap(address(0xBEEF)), 1 ether, 1, 1);
    }

    function test_windowRevertsUntilCoveredThenSucceeds() public {
        vm.expectRevert(OracleLib.WindowNotCovered.selector);
        d.hook.consult(id, C.TWAP_WINDOW);
        vm.warp(block.timestamp + C.TWAP_WINDOW);
        (int24 twap, int24 spot) = d.hook.consult(id, C.TWAP_WINDOW);
        assertEq(twap, spot);
    }

    function test_cumulativeUsesPreSwapTick() public {
        (uint32 t0, int56 cum0, int24 tick0) = d.hook.observation(id, 0);
        int24 spotBefore = _spot(id);
        assertEq(tick0, spotBefore);
        vm.warp(t0 + C.OBS_CADENCE);
        _buy(id, 5_000 ether);
        assertEq(d.hook.observationCount(id), 2);
        (uint32 t1, int56 cum1, int24 tick1) = d.hook.observation(id, d.hook.observationIndex(id));
        assertEq(t1, t0 + C.OBS_CADENCE);
        assertEq(tick1, spotBefore);
        assertEq(cum1, cum0 + int56(spotBefore) * int56(uint56(C.OBS_CADENCE)));
    }

    function test_spamCannotFlushTheWindow() public {
        vm.warp(block.timestamp + 31 minutes);
        for (uint256 i; i < 40; ++i) {
            _buy(id, 1);
            vm.warp(block.timestamp + 1);
        }
        (int24 twap,) = d.hook.consult(id, C.TWAP_WINDOW);
        twap;
        assertLe(d.hook.observationCount(id), C.OBS_CARDINALITY);
    }
}
