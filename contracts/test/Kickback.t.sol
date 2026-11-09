// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {KickbackDistributor} from "../src/kickback/KickbackDistributor.sol";

contract KickbackTest is Fixture {
    PoolId internal id;
    address internal holder = address(0x1111);

    function setUp() public override {
        super.setUp();
        (, id) = _launch(1);
    }

    function _accrue() internal {
        vm.warp(block.timestamp + 10);
        _buy(id, 1_000 ether);
    }

    function test_publisherFundsAndPosts_guardianCancels() public {
        _accrue();
        (,, uint128 available,,) = d.hook.pots(id);
        assertGt(available, 0);
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, available);
        vm.prank(publisher);
        d.distributor.postRoot(id, epoch, keccak256("root"), keccak256("manifest"));
        vm.prank(publisher);
        vm.expectRevert(KickbackDistributor.NotGuardian.selector);
        d.distributor.cancel(id, epoch);
        uint256 potBefore = _kick();
        vm.prank(admin);
        d.distributor.cancel(id, epoch);
        assertGt(_kick(), potBefore);
        (,,,,,,, bool cancelled) = d.distributor.epochs(id, epoch);
        assertTrue(cancelled);
    }

    function test_claimPaysAccountNotSender() public {
        _accrue();
        (,, uint128 available,,) = d.hook.pots(id);
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, available);
        uint256 amount = available / 2;
        bytes32 leaf = _leaf(epoch, holder, amount);
        vm.prank(publisher);
        d.distributor.postRoot(id, epoch, leaf, keccak256("manifest"));
        vm.warp(block.timestamp + 1 hours + 1);
        uint256 before = whype.balanceOf(holder);
        d.distributor.claim(id, epoch, holder, amount, new bytes32[](0));
        assertEq(whype.balanceOf(holder) - before, amount);
        vm.expectRevert(KickbackDistributor.AlreadyClaimed.selector);
        d.distributor.claim(id, epoch, holder, amount, new bytes32[](0));
    }

    function test_excludesPoolManager() public {
        _accrue();
        (,, uint128 available,,) = d.hook.pots(id);
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, available);
        bytes32 leaf = _leaf(epoch, address(pm), 1);
        vm.prank(publisher);
        d.distributor.postRoot(id, epoch, leaf, keccak256("manifest"));
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(KickbackDistributor.Excluded.selector);
        d.distributor.claim(id, epoch, address(pm), 1, new bytes32[](0));
    }

    function test_claimBeforeReviewReverts() public {
        _accrue();
        (,, uint128 available,,) = d.hook.pots(id);
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, available);
        bytes32 leaf = _leaf(epoch, holder, 1 ether);
        vm.prank(publisher);
        d.distributor.postRoot(id, epoch, leaf, keccak256("manifest"));
        vm.expectRevert(KickbackDistributor.ReviewOpen.selector);
        d.distributor.claim(id, epoch, holder, 1 ether, new bytes32[](0));
    }

    function _leaf(uint64 epoch, address account, uint256 amount) internal view returns (bytes32) {
        (address coin,,,,,,) = d.hook.config(id);
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(block.chainid, address(d.distributor), coin, address(whype), epoch, account, amount)
                )
            )
        );
    }

    function _kick() internal view returns (uint256) {
        (,, uint128 v,,) = d.hook.pots(id);
        return v;
    }
}
