// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {Fixture} from "../utils/Fixture.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {MockLzEndpoint} from "../../src/zro/MockLzEndpoint.sol";
import {MockZRO} from "../../src/zro/MockZRO.sol";
import {ZroRewardVault} from "../../src/zro/ZroRewardVault.sol";
import {ZroWeightTracker} from "../../src/zro/ZroWeightTracker.sol";

contract ZroHandler is Test {
    ZroRewardVault internal vault;
    PoolId internal id;
    uint64 internal epoch;
    address internal alice;
    address internal bob;

    constructor(ZroRewardVault vault_, PoolId id_, uint64 epoch_, address alice_, address bob_) {
        vault = vault_;
        id = id_;
        epoch = epoch_;
        alice = alice_;
        bob = bob_;
    }

    function claim(uint256 salt) external {
        address who = salt % 2 == 0 ? alice : bob;
        vm.prank(who);
        try vault.claim(id, epoch) {} catch {}
    }
}

contract ZroInvariantTest is StdInvariant, Fixture {
    ZroRewardVault internal vault;
    MockZRO internal zro;

    function setUp() public override {
        super.setUp();
        vm.warp(2 days);
        ZroWeightTracker tracker = new ZroWeightTracker(address(this), address(d.hook), address(router), address(pm));
        (address coin, PoolId id) = _launch(0);
        address alice = address(0xA11CE);
        address bob = address(0xB0B2);
        vm.prank(coin);
        tracker.onTransfer(address(0), alice, 5 ether);
        vm.prank(coin);
        tracker.onTransfer(address(0), bob, 7 ether);
        uint64 epoch = uint64(block.timestamp / 1 hours);
        vm.warp(block.timestamp + 1 hours);
        zro = new MockZRO(address(new MockLzEndpoint()), address(this));
        vault =
            new ZroRewardVault(address(this), address(this), address(d.timelock), address(this), zro, d.hook, tracker);
        vault.setSwapper(address(this));
        zro.mint(address(this), 100 ether);
        zro.approve(address(vault), 100 ether);
        vault.fund(id, epoch, 100 ether);
        targetContract(address(new ZroHandler(vault, id, epoch, alice, bob)));
    }

    function invariant_claimedNeverExceedsFunded() public view {
        assertLe(vault.totalClaimed(), vault.totalFunded());
        assertEq(vault.liabilities() + vault.pendingDust() + vault.totalClaimed(), vault.totalFunded());
    }
}
