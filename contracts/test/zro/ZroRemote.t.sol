// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "../utils/Fixture.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {MockZRO} from "../../src/zro/MockZRO.sol";
import {ZroPayout} from "../../src/zro/ZroPayout.sol";
import {ZroRewardVault} from "../../src/zro/ZroRewardVault.sol";
import {ZroWeightTracker} from "../../src/zro/ZroWeightTracker.sol";
import {TestLzEndpoint} from "./TestLzEndpoint.sol";

contract ReenteringHolder {
    ZroRewardVault public vault;
    PoolId public id;
    uint64 public epoch;
    uint32 public dstEid;
    bool public tried;
    bool public blocked;

    constructor(ZroRewardVault vault_, PoolId id_, uint64 epoch_, uint32 dstEid_) {
        vault = vault_;
        id = id_;
        epoch = epoch_;
        dstEid = dstEid_;
    }

    function claim(uint256 value) external {
        vault.claimRemote{value: value}(id, epoch, dstEid, bytes32(uint256(uint160(address(this)))), "");
    }

    receive() external payable {
        if (tried) return;
        tried = true;
        try vault.claimRemote(id, epoch, dstEid, bytes32(uint256(uint160(address(this)))), "") {
            blocked = false;
        } catch {
            blocked = true;
        }
    }
}

contract ZroRemoteTest is Fixture {
    uint32 internal constant SRC = 1;
    uint32 internal constant DST = 2;

    TestLzEndpoint internal endpoint;
    MockZRO internal zro;
    MockZRO internal remote;
    ZroRewardVault internal vault;
    ZroPayout internal payout;
    PoolId internal id;
    address internal alice = address(0xA11CE);
    uint64 internal epoch;

    function setUp() public override {
        super.setUp();
        vm.warp(2 days);
        ZroWeightTracker tracker = new ZroWeightTracker(address(this), address(d.hook), address(router), address(pm));
        address coin;
        (coin, id) = _launch(0);
        tracker.registerCoin(coin);
        epoch = uint64(vm.getBlockTimestamp() / 1 hours);
        vm.prank(coin);
        tracker.onTransfer(address(0), alice, 5 ether);
        vm.warp(vm.getBlockTimestamp() + 1 hours);

        endpoint = new TestLzEndpoint(SRC, 0.01 ether);
        zro = new MockZRO(address(endpoint), address(this), address(this));
        remote = new MockZRO(address(endpoint), address(this), address(this));
        zro.setPeer(DST, bytes32(uint256(uint160(address(remote)))));
        remote.setPeer(SRC, bytes32(uint256(uint160(address(zro)))));

        vault =
            new ZroRewardVault(address(this), address(this), address(d.timelock), address(this), zro, d.hook, tracker);
        payout = new ZroPayout(address(vault));
        vm.prank(address(d.timelock));
        vault.setPayoutModule(address(payout));
        vault.setSwapper(address(this));
        zro.mint(address(this), 100 ether);
        zro.approve(address(vault), type(uint256).max);
        vault.fund(id, epoch, 1 ether);
    }

    function test_quoteAndRemoteClaimRefundsExcessAndCannotClaimTwice() public {
        uint256 fee = vault.quoteRemote(bytes32(uint256(uint160(alice))), 1 ether, DST, "");
        assertEq(fee, 0.01 ether);
        uint256 extra = 0.04 ether;
        vm.deal(alice, 1 ether);
        uint256 before = alice.balance;
        vm.prank(alice);
        uint256 claimed = vault.claimRemote{value: fee + extra}(id, epoch, DST, bytes32(uint256(uint160(alice))), "");
        assertEq(claimed, 1 ether);
        assertEq(alice.balance, before - fee);
        assertEq(zro.balanceOf(address(vault)), 0);
        assertEq(zro.balanceOf(address(payout)), 0);
        endpoint.deliverLast();
        assertEq(remote.balanceOf(alice), 1 ether);
        assertEq(vault.totalClaimed(), 1 ether);
        assertLe(vault.totalClaimed(), vault.totalFunded());

        vm.prank(alice);
        vm.expectRevert(ZroRewardVault.AlreadyClaimed.selector);
        vault.claimRemote{value: fee}(id, epoch, DST, bytes32(uint256(uint160(alice))), "");
        vm.prank(alice);
        vm.expectRevert(ZroRewardVault.AlreadyClaimed.selector);
        vault.claim(id, epoch);
    }

    function test_shortFeeDoesNotBurnTheClaim() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(ZroPayout.FeeShort.selector);
        vault.claimRemote{value: 0.009 ether}(id, epoch, DST, bytes32(uint256(uint160(alice))), "");
        assertEq(vault.totalClaimed(), 0);
        uint256 fee = vault.quoteRemote(bytes32(uint256(uint160(alice))), 1 ether, DST, "");
        vm.prank(alice);
        assertEq(vault.claimRemote{value: fee}(id, epoch, DST, bytes32(uint256(uint160(alice))), ""), 1 ether);
    }

    function test_refundCannotReenterASecondClaim() public {
        address coin;
        PoolId other;
        (coin, other) = _launch(0);
        uint64 next = uint64(vm.getBlockTimestamp() / 1 hours);
        ReenteringHolder holder = new ReenteringHolder(vault, other, next, DST);
        ZroWeightTracker tracker = ZroWeightTracker(address(vault.tracker()));
        tracker.registerCoin(coin);
        vm.prank(coin);
        tracker.onTransfer(address(0), address(holder), 5 ether);
        assertGt(tracker.eligibleSupply(coin), 0);
        assertGt(tracker.totalWeight(coin, next * 1 hours, (next + 1) * 1 hours), 0);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        zro.mint(address(this), 1 ether);
        vault.fund(other, next, 1 ether);

        uint256 fee = vault.quoteRemote(bytes32(uint256(uint160(address(holder)))), 1 ether, DST, "");
        vm.deal(address(holder), fee + 0.05 ether);
        holder.claim(fee + 0.05 ether);
        assertTrue(holder.tried());
        assertTrue(holder.blocked());
        assertEq(address(holder).balance, 0.05 ether);
        assertEq(vault.totalClaimed(), 1 ether);
        endpoint.deliverLast();
        assertEq(remote.balanceOf(address(holder)), 1 ether);
        assertLe(vault.totalClaimed(), vault.totalFunded());
    }
}
