// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ZroWeightTracker} from "../../src/zro/ZroWeightTracker.sol";

contract ZroWeightTest is Test {
    ZroWeightTracker internal tracker;
    address internal token = address(0xBEEF);
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal pool = address(0xF00D);

    function setUp() public {
        tracker = new ZroWeightTracker(address(this), address(0x1111), address(0x2222), pool);
        tracker.registerCoin(token);
        vm.warp(10_000);
    }

    function test_buyJustBeforeTheEndEarnsAlmostNothing() public {
        uint64 start = 10_000;
        _mint(alice, 100 ether);
        vm.warp(start + 1 hours - 1);
        _mint(bob, 100 ether);
        vm.warp(start + 1 hours);
        uint256 full = tracker.weight(token, alice, start, uint64(block.timestamp));
        uint256 late = tracker.weight(token, bob, start, uint64(block.timestamp));
        assertEq(full, 100 ether * (1 hours));
        assertEq(late, 100 ether);
        assertLt(late * 3600, full + 100 ether);
    }

    function testFuzz_selfTransferDoesNotChangeWeight(uint96 bal, uint32 dt, uint96 amount) public {
        bal = uint96(bound(bal, 1, 1_000_000 ether));
        amount = uint96(bound(amount, 1, bal));
        dt = uint32(bound(dt, 0, 7 days));
        _mint(alice, bal);
        vm.warp(block.timestamp + dt);
        uint64 end = uint64(block.timestamp);
        uint256 beforeW = tracker.weight(token, alice, 10_000, end);
        vm.prank(token);
        tracker.onTransfer(alice, alice, amount);
        assertEq(tracker.weight(token, alice, 10_000, end), beforeW);
        assertEq(tracker.balanceOf(token, alice), bal);
    }

    function testFuzz_flashBuyAndSellAddsNothing(uint96 startBal, uint96 flash) public {
        startBal = uint96(bound(startBal, 0, 1_000_000 ether));
        flash = uint96(bound(flash, 1, 1_000_000 ether));
        if (startBal > 0) _mint(alice, startBal);
        uint256 beforeW = tracker.weight(token, alice, 0, uint64(block.timestamp));
        _mint(alice, flash);
        vm.prank(token);
        tracker.onTransfer(alice, bob, flash);
        assertEq(tracker.weight(token, alice, 0, uint64(block.timestamp)), beforeW);
        assertEq(tracker.weight(token, bob, 0, uint64(block.timestamp)), 0);
        assertEq(tracker.balanceOf(token, alice), startBal);
    }

    function test_sellToThePoolStopsAccrualAndPoolEarnsNothing() public {
        _mint(alice, 50 ether);
        vm.warp(block.timestamp + 100);
        vm.prank(token);
        tracker.onTransfer(alice, pool, 50 ether);
        uint256 frozen = tracker.weight(token, alice, 10_000, uint64(block.timestamp));
        vm.warp(block.timestamp + 500);
        assertEq(tracker.weight(token, alice, 10_000, uint64(block.timestamp)), frozen);
        assertEq(tracker.weight(token, pool, 10_000, uint64(block.timestamp)), 0);
    }

    function testFuzz_userWeightsMatchTheSupply(uint96 a, uint96 b, uint32 dt) public {
        a = uint96(bound(a, 0, 1_000_000 ether));
        b = uint96(bound(b, 0, 1_000_000 ether));
        dt = uint32(bound(dt, 0, 3 days));
        if (a > 0) _mint(alice, a);
        if (b > 0) _mint(bob, b);
        vm.warp(block.timestamp + dt);
        if (a > 0 && b > 0) {
            vm.prank(token);
            tracker.onTransfer(alice, bob, a / 2);
        }
        vm.warp(block.timestamp + dt);
        uint64 end = uint64(block.timestamp);
        uint256 sum = tracker.weight(token, alice, 10_000, end) + tracker.weight(token, bob, 10_000, end);
        assertEq(sum, tracker.totalWeight(token, 10_000, end));
    }

    function _mint(address to, uint256 amount) internal {
        vm.prank(token);
        tracker.onTransfer(address(0), to, amount);
    }
}
