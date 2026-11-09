// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Fixture} from "../utils/Fixture.sol";
import {KickTree} from "../utils/KickTree.sol";
import {KickbackHandler} from "./handlers/KickbackHandler.sol";
import {KickbackDistributor} from "../../src/kickback/KickbackDistributor.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";

contract CodeHolder {}

/// @notice Conservation, the 2% gas ceiling, no double pay, and the skip rules across random push/seal orders.
contract KickbackInvariantTest is StdInvariant, Fixture {
    KickbackHandler internal handler;
    address internal coin;
    PoolId internal id;
    address internal team = makeAddr("team");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    CodeHolder internal codeHolder;
    uint64 internal epoch;
    uint256 internal aliceAmt = 1 ether;
    uint256 internal bobAmt = 1_000;
    uint256 internal teamAmt = 1 ether;
    uint256 internal codeAmt = 1 ether;

    function setUp() public override {
        super.setUp();
        codeHolder = new CodeHolder();
        (coin, id) = d.launcher.launch(_params(address(whype), 1, 500, team));
        vm.warp(vm.getBlockTimestamp() + 10);
        _buy(id, 2_000 ether);
        (,,,,, uint40 launchTime,) = d.hook.config(id);
        uint256 closed = uint256(launchTime) + 1 hours;
        if (vm.getBlockTimestamp() < closed) vm.warp(closed);

        (,, uint128 available,,) = d.hook.pots(id);
        vm.prank(publisher);
        epoch = d.distributor.fund(id, available);
        assertGe(d.distributor.holderBudget(id, epoch), aliceAmt + bobAmt + teamAmt + codeAmt);

        bytes32 l0 = _leaf(alice, aliceAmt);
        bytes32 l1 = _leaf(bob, bobAmt);
        bytes32 l2 = _leaf(team, teamAmt);
        bytes32 l3 = _leaf(address(codeHolder), codeAmt);
        bytes32 h01 = KickTree.pairHash(l0, l1);
        bytes32 h23 = KickTree.pairHash(l2, l3);
        bytes32 root = KickTree.pairHash(h01, h23);
        bytes32[] memory p0 = _proof(l1, h23);
        bytes32[] memory p1 = _proof(l0, h23);
        bytes32[] memory p2 = _proof(l3, h01);
        bytes32[] memory p3 = _proof(l2, h01);
        assertTrue(MerkleProof.verify(p0, root, l0));
        assertTrue(MerkleProof.verify(p2, root, l2));

        vm.prank(publisher);
        d.distributor.postRoot(id, epoch, root, keccak256("manifest"));
        vm.warp(block.timestamp + 1 hours + 1);

        address[4] memory who = [alice, bob, team, address(codeHolder)];
        uint256[4] memory amt = [aliceAmt, bobAmt, teamAmt, codeAmt];
        handler = new KickbackHandler(d.distributor, id, epoch, who, amt, p0, p1, p2, p3);
        vm.prank(admin);
        d.distributor.setKeeper(address(handler));
        vm.txGasPrice(1 gwei);

        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](6);
        sels[0] = handler.push0.selector;
        sels[1] = handler.push1.selector;
        sels[2] = handler.push2.selector;
        sels[3] = handler.push3.selector;
        sels[4] = handler.pushAll.selector;
        sels[5] = handler.sealRound.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    function invariant_conservation() public view {
        assertTrue(d.distributor.conserves(id, epoch));
        KickbackDistributor.Round memory r = d.distributor.roundOf(id, epoch);
        assertEq(r.pushed + r.claimable + r.rollover + r.gasPaid + r.pending, r.funded);
        assertLe(r.gasPaid, r.funded * d.distributor.MAX_GAS_CAP_BPS() / 10_000);
        assertGe(whype.balanceOf(address(d.distributor)), d.distributor.liabilities(address(whype)));
    }

    function invariant_settledMatchesPot() public view {
        if (!d.distributor.roundClosed(id, epoch)) return;
        KickbackDistributor.Round memory r = d.distributor.roundOf(id, epoch);
        assertEq(r.pending, 0);
        assertEq(r.pushed + r.claimable + r.rollover, r.funded - r.gasPaid);
        assertTrue(d.distributor.holderSettled(id, epoch));
    }

    function invariant_noDoublePayAndSkips() public view {
        assertLe(whype.balanceOf(alice) + d.distributor.claimable(id, epoch, alice), aliceAmt);
        assertEq(whype.balanceOf(bob) + d.distributor.claimable(id, epoch, bob), 0);
        assertEq(whype.balanceOf(team) + d.distributor.claimable(id, epoch, team), 0);
        assertEq(whype.balanceOf(address(codeHolder)) + d.distributor.claimable(id, epoch, address(codeHolder)), 0);
    }

    function _leaf(address account, uint256 amount) internal view returns (bytes32) {
        return KickTree.leaf(block.chainid, address(d.distributor), coin, address(whype), epoch, account, amount);
    }

    function _proof(bytes32 sibling, bytes32 other) internal pure returns (bytes32[] memory proof) {
        proof = new bytes32[](2);
        proof[0] = sibling;
        proof[1] = other;
    }
}
