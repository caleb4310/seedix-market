// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {FeeMath} from "../src/libraries/FeeMath.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";

contract FeeMathTest is Test {
    function test_decayAnchors() public pure {
        assertEq(FeeMath.hookFeePips(1_000, 1_000), 800_000);
        assertEq(FeeMath.hookFeePips(1_000, 1_005), 405_000);
        assertEq(FeeMath.hookFeePips(1_000, 1_009), 89_000);
        assertEq(FeeMath.hookFeePips(1_000, 1_010), 10_000);
        assertEq(FeeMath.hookFeePips(1_000, 1_011), 10_000);
    }

    function test_workedBuyExamples() public pure {
        (uint256 plat, uint256 hook, uint256 lp, uint256 worth) = FeeMath.quoteBuy(100 ether, 10_000);
        assertEq(plat, 1 ether);
        assertEq(hook, 1 ether);
        assertEq(lp, 0.098 ether);
        assertEq(worth, 97.902 ether);

        (plat, hook, lp, worth) = FeeMath.quoteBuy(100 ether, 800_000);
        assertEq(plat, 1 ether);
        assertEq(hook, 80 ether);
        assertEq(lp, 0.019 ether);
        assertEq(worth, 18.981 ether);

        (plat, hook, lp, worth) = FeeMath.quoteBuy(100 ether, 405_000);
        assertEq(plat, 1 ether);
        assertEq(hook, 40.5 ether);
        assertEq(lp, 0.0585 ether);
        assertEq(worth, 58.4415 ether);

        (plat, hook, lp, worth) = FeeMath.quoteBuy(100 ether, 89_000);
        assertEq(plat, 1 ether);
        assertEq(hook, 8.9 ether);
        assertEq(lp, 0.0901 ether);
        assertEq(worth, 90.0099 ether);
    }

    function test_baseExcessIsOnePercentOfGross() public pure {
        uint256 gross = 100 ether;
        uint256 hookAmt = FeeMath.feeDown(gross, 800_000);
        (uint256 baseAmt, uint256 excess) = FeeMath.splitBaseExcess(hookAmt, 800_000);
        assertEq(baseAmt, 1 ether);
        assertEq(excess, 79 ether);
        assertEq(baseAmt + excess, hookAmt);
    }

    function test_platformSplitSums() public pure {
        (uint256 burn, uint256 wallet) = FeeMath.splitPlatform(1 ether, false);
        assertEq(burn, 0.5 ether);
        assertEq(wallet, 0.5 ether);
        (burn, wallet) = FeeMath.splitPlatform(3, false);
        assertEq(burn + wallet, 3);
        (burn, wallet) = FeeMath.splitPlatform(1 ether, true);
        assertEq(burn, 1 ether);
        assertEq(wallet, 0);
    }

    function testFuzz_decayMonotone(uint32 a, uint32 b) public pure {
        uint256 t1 = uint256(a) % (C.DECAY_SECONDS + 5);
        uint256 t2 = uint256(b) % (C.DECAY_SECONDS + 5);
        uint256 f1 = FeeMath.hookFeePips(0, t1);
        uint256 f2 = FeeMath.hookFeePips(0, t2);
        if (t1 < t2) assertGe(f1, f2);
        if (t1 >= 10 && t2 >= 10) assertEq(f1, f2);
        assertGe(f1, C.END_FEE);
        assertLe(f1, C.START_FEE);
    }

    function testFuzz_exactInNeverExceedsGross(uint128 gross, uint8 elapsed) public pure {
        uint256 g = uint256(gross);
        uint256 pips = FeeMath.hookFeePips(0, elapsed % 15);
        (uint256 hookAmt, uint256 plat) = FeeMath.exactInBuy(g, pips);
        assertLe(hookAmt + plat, g);
        (uint256 baseAmt, uint256 excess) = FeeMath.splitBaseExcess(hookAmt, pips);
        assertEq(baseAmt + excess, hookAmt);
    }

    function testFuzz_grossUpCoversRate(uint128 netRaw, uint8 elapsed) public pure {
        uint256 net = uint256(netRaw);
        vm.assume(net > 1_000);
        uint256 pips = FeeMath.hookFeePips(0, elapsed % 15);
        uint256 total = pips + C.PLATFORM_FEE;
        (uint256 gross, uint256 fee) = FeeMath.grossUp(net, total);
        assertEq(gross, net + fee);
        assertGe(fee, net * total / C.PIPS);
        assertLt(gross - (net * C.PIPS / (C.PIPS - total)), C.PIPS);
    }
}
