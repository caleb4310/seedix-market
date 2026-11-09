// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {OracleLib} from "../src/libraries/OracleLib.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";
import {BuybackExecutor} from "../src/buyback/BuybackExecutor.sol";

contract OracleTest is Fixture {
    PoolId internal id;
    address internal coin;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(0);
        IERC20(coin).approve(address(router), type(uint256).max);
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
        uint256 t = vm.getBlockTimestamp();
        for (uint256 i; i < 70; ++i) {
            vm.warp(t + (i + 1) * C.OBS_CADENCE);
            _buy(id, 1);
        }
        assertEq(d.hook.observationCount(id), C.OBS_CARDINALITY, "cadence writes fill the ring");
        uint256 end = vm.getBlockTimestamp();
        uint16 filled = d.hook.observationCount(id);
        for (uint256 i; i < 40; ++i) {
            vm.warp(end + i + 1);
            _buy(id, 1);
        }
        assertEq(d.hook.observationCount(id), filled, "sub-cadence spam does not append");
        d.hook.consult(id, C.TWAP_WINDOW);
    }

    /// @dev Sentinel PoC. A one-block pump used to be credited for the whole 30s slot and then
    ///      for every idle second after it. The cumulative now keeps the honest seconds, and the
    ///      tail after the last accrual uses the live tick, so the 30-minute TWAP is not pinned.
    function test_R_oracleStaleExtrapolationPinsTwap() public {
        vm.warp(vm.getBlockTimestamp() + 31 minutes);
        _buy(id, 2_000 ether);
        int24 honest = _spot(id);
        uint256 t = vm.getBlockTimestamp();
        (uint32 tPrev, int56 cumPrev,) = d.hook.observation(id, d.hook.observationIndex(id));
        assertEq(tPrev, uint32(t));

        vm.warp(t + 29);
        _buy(id, 20_000 ether);
        int24 pumped = _spot(id);
        assertTrue(pumped != honest);

        vm.warp(t + 30);
        _buy(id, 1e12);
        (uint32 tWrite, int56 cumWrite, int24 stored) = d.hook.observation(id, d.hook.observationIndex(id));
        assertEq(tWrite, uint32(t + 30));
        assertEq(stored, pumped);
        int56 accrued = cumPrev + int56(honest) * int56(uint56(29)) + int56(pumped) * int56(uint56(1));
        assertEq(cumWrite, accrued, "only the pumped second is credited to the pumped tick");
        assertTrue(cumWrite != cumPrev + int56(pumped) * int56(uint56(30)));

        vm.warp(t + 31);
        uint256 coins = IERC20(coin).balanceOf(address(this));
        _sell(id, coins);

        vm.warp(t + 31 + 30 minutes);
        (int24 twap, int24 spot) = d.hook.consult(id, C.TWAP_WINDOW);
        int24 dist = twap > spot ? twap - spot : spot - twap;
        assertLe(dist, C.BAND_TICKS, "twap follows the idle spot");

        try d.executor.buybackCoin(id, 1 ether, 1) returns (uint256) {
            revert("expected deferral");
        } catch (bytes memory data) {
            assertEq(bytes4(data), BuybackExecutor.BuybackSwapDeferred.selector);
        }
    }
}
