// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Sentinel recheck-3 tests, adapted to the debited pots, the shared platform interval, and extreme price limits.
import {Fixture} from "../utils/Fixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {SeedixConstants as C} from "../../src/libraries/SeedixConstants.sol";
import {BuybackExecutor} from "../../src/buyback/BuybackExecutor.sol";

contract ReviewRecheck3Test is Fixture {
    PoolId internal id;
    address internal coin;
    PoolId internal platId;
    address internal plat;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(2); // burn mode
        vm.prank(admin);
        (plat, platId) = d.launcher.launchPlatformToken(_params(address(whype), 0, 0, address(0)));
        IERC20(coin).approve(address(router), type(uint256).max);
        IERC20(plat).approve(address(router), type(uint256).max);
        _buy(id, 20 ether); // fills burnPair of `id` in the decay window
        _buy(platId, 20 ether);
        // register the memecoin/WHYPE pool as the route for `coin` (timelock, 48h)
        bytes memory data = abi.encodeCall(d.executor.registerRoute, (Currency.wrap(coin), id));
        TimelockController tl = d.roles.timelock();
        vm.prank(admin);
        tl.schedule(address(d.executor), 0, data, bytes32(0), keccak256("route"), 48 hours);
        vm.warp(vm.getBlockTimestamp() + 48 hours + 1);
        vm.prank(admin);
        tl.execute(address(d.executor), 0, data, bytes32(0), keccak256("route"));
        // settled pools + honest trades so TWAP/spot stay in band
        _buy(id, 1 ether);
        _buy(platId, 1 ether);
        vm.warp(vm.getBlockTimestamp() + 1);
    }

    function _burnPair(PoolId p) internal view returns (uint128 b) {
        (,,, b,) = d.hook.pots(p);
    }

    function test_RC3_setKeeperAccess() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(BuybackExecutor.NotAdmin.selector);
        d.executor.setKeeper(address(0xBAD));
        // The timelock itself cannot set or revoke the keeper. Mainnet must timelock the grant in a later script.
        vm.prank(address(d.roles.timelock()));
        vm.expectRevert(BuybackExecutor.NotAdmin.selector);
        d.executor.setKeeper(address(0));
        vm.prank(admin);
        d.executor.setKeeper(address(0));
        vm.expectRevert(BuybackExecutor.NotKeeper.selector);
        d.executor.buybackCoin(id, 1, 1);
        vm.prank(address(0));
        vm.expectRevert(BuybackExecutor.NotKeeper.selector);
        d.executor.buybackCoin(id, 1, 1);
    }

    function test_RC3_coinBuybackSizedToPot() public {
        uint256 pot = _burnPair(id);
        assertGt(pot, 0);
        vm.expectRevert(abi.encodeWithSelector(BuybackExecutor.ExceedsPot.selector, pot));
        d.executor.buybackCoin(id, pot + 1, 1);
        d.executor.buybackCoin(id, pot, 1);
        assertEq(_burnPair(id), 0);
    }

    /// Reserving debits the pot in the same call, so the next interval cannot reserve it again.
    function test_RC3_reserveMovesNothing() public {
        uint256 pot = _burnPair(id);
        d.executor.buybackCoin(id, pot, 1);
        assertEq(_burnPair(id), 0, "pot is debited");
        assertEq(whype.balanceOf(address(d.executor)), pot, "the pair tokens move with the debit");
        vm.warp(vm.getBlockTimestamp() + C.BUYBACK_INTERVAL);
        vm.expectRevert(abi.encodeWithSelector(BuybackExecutor.ExceedsPot.selector, uint256(0)));
        d.executor.buybackCoin(id, pot, 1);
    }

    function test_RC3_firstCallAndEdge() public {
        assertEq(d.executor.lastBuybackAt(id), 0);
        uint256 t0 = vm.getBlockTimestamp();
        d.executor.buybackCoin(id, 1, 1);
        vm.warp(t0 + C.BUYBACK_INTERVAL - 1);
        vm.expectRevert(BuybackExecutor.TooSoon.selector);
        d.executor.buybackCoin(id, 1, 1);
        vm.warp(t0 + C.BUYBACK_INTERVAL);
        d.executor.buybackCoin(id, 1, 1);
    }

    /// Platform pool: buybackCoin(platId) and buybackPlatform(WHYPE) share the platform pool's interval.
    function test_RC3_platformIntervalSharedForWhypeLeg() public {
        d.executor.buybackCoin(platId, 1, 1);
        vm.expectRevert(BuybackExecutor.TooSoon.selector);
        d.executor.buybackPlatform(Currency.wrap(address(whype)), 1, 1, 1);
    }

    /// A second platform buyback in the same block reverts, and the route coin's slot stays free.
    function test_RC3_platformIntervalBypassViaStockLeg() public {
        d.executor.buybackPlatform(Currency.wrap(address(whype)), 1, 1, 1);
        assertEq(d.executor.lastBuybackAt(platId), vm.getBlockTimestamp());
        vm.expectRevert(BuybackExecutor.TooSoon.selector);
        d.executor.buybackPlatform(Currency.wrap(coin), 1, 1, 1);
        assertEq(d.executor.lastBuybackAt(id), 0, "route pool is not stamped");
    }

    /// The stock leg is capped by platformBurn[pair] and does not block the route coin's buyback.
    function test_RC3_stockLegConsumesRoutePoolBudget() public {
        uint256 routePot = _burnPair(id);
        uint256 platBudget = d.hook.platformBurn(Currency.wrap(coin));
        assertLt(platBudget, routePot, "the route pot is not the platform budget");
        vm.expectRevert(abi.encodeWithSelector(BuybackExecutor.ExceedsPot.selector, platBudget));
        d.executor.buybackPlatform(Currency.wrap(coin), routePot, 1, 1);
        d.executor.buybackCoin(id, 1, 1);
        assertEq(d.executor.lastBuybackAt(id), vm.getBlockTimestamp());
    }

    /// The WHYPE leg is sized to platformBurn[WHYPE], and that balance is debited.
    function test_RC3_platformWhypeLegWrongPot() public {
        uint256 platPoolPot = _burnPair(platId);
        Currency whypeC = Currency.wrap(address(whype));
        uint256 realBudget = d.hook.platformBurn(whypeC);
        assertGt(realBudget, 0);
        assertGt(platPoolPot, realBudget);
        vm.expectRevert(abi.encodeWithSelector(BuybackExecutor.ExceedsPot.selector, realBudget));
        d.executor.buybackPlatform(whypeC, platPoolPot, 1, 1);
        d.executor.buybackPlatform(whypeC, realBudget, 1, 1);
        assertEq(d.hook.platformBurn(whypeC), 0);
        assertEq(whype.balanceOf(address(d.executor)), realBudget);
    }
}

import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// A fresh pool after the decay. Min-out carries the slippage. The price limit is the extreme bound.
contract ReviewRecheck3WebLimitTest is Fixture {
    using StateLibrary for IPoolManager;

    PoolId internal id;
    address internal coin;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(0);
        vm.warp(vm.getBlockTimestamp() + 60); // past the decay
    }

    function _try(uint256 amountIn, uint256 slipBps) internal returns (bool ok, uint256 quote) {
        (,, bool coinIsToken0,,,,) = d.hook.config(id);
        bool z = !coinIsToken0;
        uint256 snap = vm.snapshotState();
        BalanceDelta q = _swap(id, z, -int256(amountIn));
        quote = uint256(uint128(z ? q.amount1() : q.amount0()));
        vm.revertToState(snap);
        uint160 lim = z ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        uint256 minOut = quote * (10_000 - slipBps) / 10_000;
        try router.swap(_key(id), z, -int256(amountIn), minOut, block.timestamp, lim) {
            ok = true;
        } catch (bytes memory err) {
            ok = false;
            err;
        }
    }

    function test_RC3_webPriceLimitRevertsOrdinaryBuys() public {
        (bool ok225,) = _try(225 ether, 100);
        assertTrue(ok225, "225 WHYPE at 1% slippage fills on a fresh pool");
        (bool ok500,) = _try(500 ether, 100);
        assertTrue(ok500, "500 WHYPE at 1% slippage fills when min-out is the protection");
    }
}
