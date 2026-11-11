// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {KickbackDistributor} from "../src/kickback/KickbackDistributor.sol";

contract KickbackSafetyTest is Fixture {
    PoolId internal id;
    address internal holder = address(0x1111);

    function setUp() public override {
        super.setUp();
        (, id) = _launch(1);
        vm.warp(vm.getBlockTimestamp() + 10);
        _buy(id, 1_000 ether);
        (,,,,, uint40 launchTime,) = d.hook.config(id);
        uint256 closed = uint256(launchTime) + 1 hours;
        if (vm.getBlockTimestamp() < closed) vm.warp(closed);
    }

    function _available() internal view returns (uint128) {
        (,, uint128 v,,) = d.hook.pots(id);
        return v;
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

    function test_claimDoubleClaimOverClaimAndWrongProof() public {
        uint128 available = _available();
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, available);
        uint256 amount = available / 2;
        bytes32 leaf = _leaf(epoch, holder, amount);
        vm.prank(publisher);
        d.distributor.postRootAllocated(id, epoch, leaf, keccak256("manifest"), uint128(amount));
        vm.warp(block.timestamp + 1 hours + 1);

        vm.expectRevert(KickbackDistributor.BadProof.selector);
        d.distributor.claim(id, epoch, holder, amount, new bytes32[](1));

        d.distributor.claim(id, epoch, holder, amount, new bytes32[](0));
        vm.expectRevert(KickbackDistributor.AlreadyClaimed.selector);
        d.distributor.claim(id, epoch, holder, amount, new bytes32[](0));

        vm.prank(publisher);
        vm.expectRevert(KickbackDistributor.Cap.selector);
        d.distributor.postRootAllocated(id, epoch, leaf, keccak256("manifest"), uint128(uint256(available) + 1));
    }

    function test_strangerCannotPostRootAndPauseBlocksFund() public {
        vm.expectRevert(KickbackDistributor.NotPublisher.selector);
        d.distributor.postRoot(id, 1, keccak256("root"), keccak256("manifest"));

        vm.prank(admin);
        d.distributor.pause();
        uint128 available = _available();
        vm.prank(publisher);
        vm.expectRevert(KickbackDistributor.Paused.selector);
        d.distributor.fund(id, available);

        vm.prank(admin);
        vm.expectRevert(KickbackDistributor.NotTimelock.selector);
        d.distributor.unpause();
        vm.prank(address(d.roles.timelock()));
        d.distributor.unpause();
        uint128 pot = _available();
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, pot);
        assertGt(epoch, 0);
    }

    function test_publisherPushPaysOnceAndStrangerCannot() public {
        uint128 available = _available();
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, available);
        uint256 amount = available / 2;
        bytes32 leaf = _leaf(epoch, holder, amount);
        vm.prank(publisher);
        d.distributor.postRootAllocated(id, epoch, leaf, keccak256("manifest"), uint128(amount));
        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(address(0xBEEF));
        vm.expectRevert(KickbackDistributor.NotPublisher.selector);
        d.distributor.push(id, epoch, _one(holder), _one(amount), _proofs());

        uint256 before = whype.balanceOf(holder);
        uint256 gasBefore = gasleft();
        vm.prank(publisher);
        d.distributor.push(id, epoch, _one(holder), _one(amount), _proofs());
        uint256 pushGas = gasBefore - gasleft();
        emit log_named_uint("one holder push gas", pushGas);
        assertLt(pushGas, 400_000, "one holder push");
        assertEq(whype.balanceOf(holder) - before, amount);

        vm.prank(publisher);
        vm.expectRevert(KickbackDistributor.AlreadyClaimed.selector);
        d.distributor.push(id, epoch, _one(holder), _one(amount), _proofs());

        vm.prank(admin);
        d.distributor.pause();
        vm.prank(publisher);
        vm.expectRevert(KickbackDistributor.Paused.selector);
        d.distributor.seal(id, epoch);
    }

    /// @dev Gas is taken from the funded pot. The publisher's WHYPE balance rises by `gasPaid`,
    ///      and that amount cannot exceed 2% of the round. The rest is holders plus rollover.
    function test_gasIsPaidFromTheRoundAndCapped() public {
        uint128 available = _available();
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, available);
        uint256 amount = available / 2;
        bytes32 leaf = _leaf(epoch, holder, amount);
        vm.prank(publisher);
        d.distributor.postRootAllocated(id, epoch, leaf, keccak256("manifest"), uint128(amount));
        vm.warp(block.timestamp + 1 hours + 1);

        vm.txGasPrice(100_000 gwei);
        uint256 publisherBefore = whype.balanceOf(publisher);
        vm.prank(publisher);
        d.distributor.push(id, epoch, _one(holder), _one(amount), _proofs());
        vm.prank(publisher);
        d.distributor.seal(id, epoch);

        KickbackDistributor.Round memory round = d.distributor.roundOf(id, epoch);
        uint256 cap = round.funded * d.distributor.gasCapBps() / 10_000;
        assertEq(round.pending, 0);
        assertEq(round.pushed + round.claimable + round.rollover + round.gasPaid, round.funded);
        assertGt(round.gasPaid, 0);
        assertLe(round.gasPaid, cap);
        assertEq(whype.balanceOf(publisher) - publisherBefore, round.gasPaid);
        assertEq(round.pushed, amount);
        assertEq(d.executor.quoteReward(address(whype), 1 ether), 1 ether);
    }

    function _one(address account) internal pure returns (address[] memory a) {
        a = new address[](1);
        a[0] = account;
    }

    function _one(uint256 amount) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = amount;
    }

    function _proofs() internal pure returns (bytes32[][] memory proofs) {
        proofs = new bytes32[][](1);
        proofs[0] = new bytes32[](0);
    }
}
