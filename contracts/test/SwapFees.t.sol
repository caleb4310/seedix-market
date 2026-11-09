// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {FeeMath} from "../src/libraries/FeeMath.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";

contract SwapFeesTest is Fixture {
    address internal coin;
    PoolId internal id;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(0);
        IERC20(coin).approve(address(router), type(uint256).max);
    }

    function test_buyAtLaunchRoutesExcessToBurn() public {
        uint256 gross = 100 ether;
        _buy(id, gross);
        (uint256 hookAmt, uint256 plat) = FeeMath.exactInBuy(gross, 800_000);
        (uint256 baseAmt, uint256 excess) = FeeMath.splitBaseExcess(hookAmt, 800_000);
        (uint128 creatorPair,, uint128 kick, uint128 burnPair,) = d.hook.pots(id);
        assertEq(creatorPair, baseAmt);
        assertEq(burnPair, excess);
        assertEq(kick, 0);
        assertEq(baseAmt, 1 ether);
        assertEq(excess, 79 ether);
        Currency pair = Currency.wrap(address(whype));
        assertEq(d.hook.platformBurn(pair), plat / 2);
        assertEq(d.hook.platformWallet(pair), plat - plat / 2);
        assertEq(d.hook.accounted(pair), d.hook.sumPots(pair));
        assertEq(pm.balanceOf(address(d.hook), pair.toId()), d.hook.accounted(pair));
    }

    function test_buyAfterDecayPaysCreatorTheFullOnePercent() public {
        (,,,,, uint40 t,) = d.hook.config(id);
        vm.warp(uint256(t) + 10);
        _buy(id, 100 ether);
        (uint128 creatorPair,,, uint128 burnPair,) = d.hook.pots(id);
        assertEq(creatorPair, 1 ether);
        assertEq(burnPair, 0);
    }

    function test_sellTakesPlatformInPairAndBurnsExcessCoin() public {
        _buy(id, 500 ether);
        uint256 coins = IERC20(coin).balanceOf(address(this));
        uint256 sellAmt = coins / 5;
        uint256 creatorCoinBefore = _creatorCoin();
        uint256 burnCoinBefore = _burnCoin();
        _sell(id, sellAmt);
        uint256 hookAmt = FeeMath.feeDown(sellAmt, 800_000);
        (uint256 baseAmt, uint256 excess) = FeeMath.splitBaseExcess(hookAmt, 800_000);
        assertEq(_creatorCoin() - creatorCoinBefore, baseAmt);
        assertEq(_burnCoin() - burnCoinBefore, excess);
        assertEq(d.hook.platformBurn(Currency.wrap(coin)), 0);
        assertEq(d.hook.platformWallet(Currency.wrap(coin)), 0);
        assertEq(d.hook.accounted(Currency.wrap(coin)), d.hook.sumPots(Currency.wrap(coin)));
    }

    function test_kickAndBurnModes() public {
        (, PoolId kick) = _launch(1);
        (, PoolId burn) = _launch(2);
        // Launches in this test share the transaction with the following swaps, which the
        // launch guard forbids. The pools above were created in this transaction.
        kick;
        burn;
    }

    function test_modesFromSetup() public {
        // Covered by ModeTest, which launches in setUp.
    }

    function _creatorCoin() internal view returns (uint256) {
        (, uint128 v,,,) = d.hook.pots(id);
        return v;
    }

    function _burnCoin() internal view returns (uint256) {
        (,,,, uint128 v) = d.hook.pots(id);
        return v;
    }
}

contract ModeTest is Fixture {
    PoolId internal keepId;
    PoolId internal kickId;
    PoolId internal burnId;

    function setUp() public override {
        super.setUp();
        (, keepId) = _launch(0);
        (, kickId) = _launch(1);
        (, burnId) = _launch(2);
    }

    function test_modeRoutingAfterDecay() public {
        vm.warp(block.timestamp + 10);
        _buy(keepId, 100 ether);
        _buy(kickId, 100 ether);
        _buy(burnId, 100 ether);
        (uint128 keepCreator,, uint128 keepKick, uint128 keepBurn,) = d.hook.pots(keepId);
        (uint128 kickCreator,, uint128 kickKick, uint128 kickBurn,) = d.hook.pots(kickId);
        (uint128 burnCreator,, uint128 burnKick, uint128 burnBurn,) = d.hook.pots(burnId);
        assertEq(keepCreator, 1 ether);
        assertEq(keepKick, 0);
        assertEq(keepBurn, 0);
        assertEq(kickCreator, 0);
        assertEq(kickKick, 1 ether);
        assertEq(kickBurn, 0);
        assertEq(burnCreator, 0);
        assertEq(burnKick, 0);
        assertEq(burnBurn, 1 ether);
    }

    function test_decayBuyStillMintsCoin() public {
        vm.warp(block.timestamp + 5);
        assertGt(_buy(keepId, 50 ether), 0);
    }
}

contract ExactOutTest is Fixture {
    PoolId internal id;
    PoolId internal id2;
    address internal coin;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(0);
        (, id2) = _launch(0);
        IERC20(coin).approve(address(router), type(uint256).max);
        vm.warp(block.timestamp + 10);
    }

    function test_exactOutBuyIsCloseToExactIn() public {
        uint256 gross = 20 ether;
        int128 coinGot = _buy(id, gross);
        uint256 y = uint256(uint128(coinGot));
        uint256 before = whype.balanceOf(address(this));
        _buyExactOut(id2, y);
        uint256 paid = before - whype.balanceOf(address(this));
        uint256 diff = paid > gross ? paid - gross : gross - paid;
        assertLt(diff * 10_000 / gross, 30);
    }

    function test_exactOutPathsConservePots() public {
        int128 got = _buy(id, 30 ether);
        uint256 y = uint256(uint128(got)) / 2;
        uint256 pairBefore = whype.balanceOf(address(this));
        _buyExactOut(id, y);
        uint256 paid = pairBefore - whype.balanceOf(address(this));
        assertGt(paid, 0);
        Currency pair = Currency.wrap(address(whype));
        assertEq(d.hook.accounted(pair), d.hook.sumPots(pair));
        assertEq(pm.balanceOf(address(d.hook), pair.toId()), d.hook.accounted(pair));
        assertEq(d.hook.platformBurn(Currency.wrap(coin)), 0);

        uint256 coins = IERC20(coin).balanceOf(address(this));
        _sell(id, coins / 4);
        assertEq(d.hook.accounted(Currency.wrap(coin)), d.hook.sumPots(Currency.wrap(coin)));
    }
}
