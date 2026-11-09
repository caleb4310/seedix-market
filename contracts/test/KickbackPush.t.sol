// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Fixture} from "./utils/Fixture.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {KickbackDistributor} from "../src/kickback/KickbackDistributor.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";

contract RejectingReceiver {
    // No token hook. Transfers still succeed unless the token itself reverts.
}

contract KickbackPushTest is Fixture {
    PoolId internal id;
    address internal coin;
    address internal holder = address(0x1111);
    address internal other = address(0x2222);
    address internal team = address(0xBEEF);
    RejectingReceiver internal code;

    function setUp() public override {
        super.setUp();
        code = new RejectingReceiver();
        (coin, id) = d.launcher.launch(_params(address(whype), 1, 0, team));
        vm.prank(admin);
        d.distributor.setKeeper(address(this));
    }

    function _accrue() internal {
        vm.warp(vm.getBlockTimestamp() + 10);
        _buy(id, 1_000 ether);
        (,,,,, uint40 launchTime,) = d.hook.config(id);
        uint256 closed = uint256(launchTime) + 1 hours;
        if (vm.getBlockTimestamp() < closed) vm.warp(closed);
    }

    function _leaf(uint64 epoch, address account, uint256 amount) internal view returns (bytes32) {
        return keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(block.chainid, address(d.distributor), coin, address(whype), epoch, account, amount)
                )
            )
        );
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    function _open(uint64 epoch, bytes32 root) internal {
        vm.prank(publisher);
        d.distributor.postRoot(id, epoch, root, keccak256("manifest"));
        vm.warp(block.timestamp + C.REVIEW_WINDOW + 1);
    }

    function test_pushPaysOnceAndSkipsTeamContractAndDust() public {
        _accrue();
        (,, uint128 available,,) = d.hook.pots(id);
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, available);
        uint256 pay = 1 ether;
        uint256 dust = 100;
        bytes32 leafPay = _leaf(epoch, holder, pay);
        bytes32 leafDust = _leaf(epoch, other, dust);
        bytes32 leafTeam = _leaf(epoch, team, pay);
        bytes32 leafCode = _leaf(epoch, address(code), pay);
        bytes32 left = _pair(leafPay, leafDust);
        bytes32 right = _pair(leafTeam, leafCode);
        bytes32 root = _pair(left, right);
        _open(epoch, root);

        address[] memory accounts = new address[](4);
        uint256[] memory amounts = new uint256[](4);
        bytes32[][] memory proofs = new bytes32[][](4);
        accounts[0] = holder;
        amounts[0] = pay;
        proofs[0] = new bytes32[](2);
        proofs[0][0] = leafDust;
        proofs[0][1] = right;
        accounts[1] = other;
        amounts[1] = dust;
        proofs[1] = new bytes32[](2);
        proofs[1][0] = leafPay;
        proofs[1][1] = right;
        accounts[2] = team;
        amounts[2] = pay;
        proofs[2] = new bytes32[](2);
        proofs[2][0] = leafCode;
        proofs[2][1] = left;
        accounts[3] = address(code);
        amounts[3] = pay;
        proofs[3] = new bytes32[](2);
        proofs[3][0] = leafTeam;
        proofs[3][1] = left;

        uint256 balBefore = whype.balanceOf(address(d.distributor));
        (uint256 paid, uint256 rolled, uint256 failed) = d.distributor.push(id, epoch, accounts, amounts, proofs);
        assertEq(paid, pay);
        assertEq(rolled, dust + pay + pay);
        assertEq(failed, 0);
        assertEq(whype.balanceOf(holder), pay);
        assertEq(whype.balanceOf(team), 0);
        assertEq(whype.balanceOf(address(code)), 0);
        assertEq(whype.balanceOf(address(d.distributor)), balBefore - pay);
        assertEq(d.distributor.liabilities(address(whype)), balBefore - pay);
        assertEq(d.distributor.rollover(id), dust + pay + pay);

        vm.expectRevert(KickbackDistributor.AlreadyClaimed.selector);
        d.distributor.claim(id, epoch, holder, pay, proofs[0]);
        vm.expectRevert(KickbackDistributor.AlreadyClaimed.selector);
        d.distributor.push(id, epoch, accounts, amounts, proofs);
    }

    function test_failedTransferIsClaimableOnce() public {
        _accrue();
        (,, uint128 available,,) = d.hook.pots(id);
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, available);
        uint256 pay = 1 ether;
        bytes32 leaf = _leaf(epoch, holder, pay);
        _open(epoch, leaf);
        vm.mockCall(address(whype), abi.encodeCall(IERC20.transfer, (holder, pay)), abi.encode(false));

        address[] memory accounts = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes32[][] memory proofs = new bytes32[][](1);
        accounts[0] = holder;
        amounts[0] = pay;
        proofs[0] = new bytes32[](0);
        (uint256 paid,, uint256 failed) = d.distributor.push(id, epoch, accounts, amounts, proofs);
        assertEq(paid, 0);
        assertEq(failed, pay);
        assertEq(d.distributor.fallbackOf(id, epoch, holder), pay);
        assertEq(whype.balanceOf(holder), 0);

        vm.clearMockedCalls();
        d.distributor.claimFallback(id, epoch, holder);
        assertEq(whype.balanceOf(holder), pay);
        assertEq(d.distributor.fallbackOf(id, epoch, holder), 0);
        vm.expectRevert(KickbackDistributor.BadEpoch.selector);
        d.distributor.claimFallback(id, epoch, holder);
        assertEq(whype.balanceOf(address(d.distributor)), d.distributor.liabilities(address(whype)));
    }

    function test_dustRollsIntoTheNextEpoch() public {
        _accrue();
        (,, uint128 available,,) = d.hook.pots(id);
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, 1 ether);
        assertGt(available, 2 ether);
        bytes32 leaf = _leaf(epoch, holder, 100);
        _open(epoch, leaf);
        address[] memory accounts = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes32[][] memory proofs = new bytes32[][](1);
        accounts[0] = holder;
        amounts[0] = 100;
        d.distributor.push(id, epoch, accounts, amounts, proofs);
        assertEq(d.distributor.rollover(id), 100);

        vm.warp(block.timestamp + 2 hours);
        vm.prank(publisher);
        uint64 next = d.distributor.fund(id, 1 ether);
        (uint128 funded,,,,,,,) = d.distributor.epochs(id, next);
        assertEq(funded, 1 ether + 100);
        assertEq(d.distributor.rollover(id), 0);
        assertEq(whype.balanceOf(address(d.distributor)), d.distributor.liabilities(address(whype)));
    }

    function test_mainnetGasCapIsTwoPercent() public {
        _accrue();
        (,, uint128 available,,) = d.hook.pots(id);
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, available);
        uint256 pay = 1 ether;
        vm.chainId(99901);
        bytes32 leaf = _leaf(epoch, holder, pay);
        _open(epoch, leaf);
        vm.txGasPrice(100 gwei);
        address[] memory accounts = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes32[][] memory proofs = new bytes32[][](1);
        accounts[0] = holder;
        amounts[0] = pay;
        uint256 before = whype.balanceOf(address(this));
        d.distributor.push(id, epoch, accounts, amounts, proofs);
        uint256 reimbursed = whype.balanceOf(address(this)) - before;
        assertLe(reimbursed, pay * 200 / 10_000);
        assertGt(reimbursed, 0);
        assertEq(whype.balanceOf(address(d.distributor)), d.distributor.liabilities(address(whype)));
    }

    function testFuzz_pushConservesThePot(uint8 seed) public {
        _accrue();
        (,, uint128 available,,) = d.hook.pots(id);
        uint256 a = 1 ether + (uint256(seed) % 5) * 0.1 ether;
        uint256 b = 2 ether;
        vm.assume(a + b <= available);
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, uint128(a + b));
        bytes32 leafA = _leaf(epoch, holder, a);
        bytes32 leafB = _leaf(epoch, other, b);
        bytes32 root = _pair(leafA, leafB);
        _open(epoch, root);
        address[] memory accounts = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        bytes32[][] memory proofs = new bytes32[][](2);
        accounts[0] = holder;
        amounts[0] = a;
        proofs[0] = new bytes32[](1);
        proofs[0][0] = leafB;
        accounts[1] = other;
        amounts[1] = b;
        proofs[1] = new bytes32[](1);
        proofs[1][0] = leafA;
        uint256 start = whype.balanceOf(address(d.distributor));
        (uint256 paid,,) = d.distributor.push(id, epoch, accounts, amounts, proofs);
        assertEq(paid, a + b);
        assertEq(whype.balanceOf(holder) + whype.balanceOf(other), paid);
        assertEq(whype.balanceOf(address(d.distributor)), start - paid);
        assertEq(whype.balanceOf(address(d.distributor)), d.distributor.liabilities(address(whype)));
    }
}

contract PushHandler is Test {
    KickbackDistributor public immutable dist;
    IERC20 public immutable token;
    PoolId public immutable id;
    address public immutable a;
    address public immutable b;
    uint256 public immutable amtA;
    uint256 public immutable amtB;
    bytes32 public immutable leafA;
    bytes32 public immutable leafB;
    uint256 public paidOut;

    constructor(
        KickbackDistributor dist_,
        IERC20 token_,
        PoolId id_,
        address a_,
        address b_,
        uint256 amtA_,
        uint256 amtB_,
        bytes32 leafA_,
        bytes32 leafB_
    ) {
        dist = dist_;
        token = token_;
        id = id_;
        a = a_;
        b = b_;
        amtA = amtA_;
        amtB = amtB_;
        leafA = leafA_;
        leafB = leafB_;
    }

    function pushA() external {
        _one(a, amtA, leafB);
    }

    function pushB() external {
        _one(b, amtB, leafA);
    }

    function _one(address account, uint256 amount, bytes32 sibling) internal {
        if (dist.claimed(id, 1, account)) return;
        address[] memory accounts = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes32[][] memory proofs = new bytes32[][](1);
        accounts[0] = account;
        amounts[0] = amount;
        proofs[0] = new bytes32[](1);
        proofs[0][0] = sibling;
        uint256 before = token.balanceOf(address(dist));
        (uint256 paid,,) = dist.push(id, 1, accounts, amounts, proofs);
        paidOut += paid;
        assertEq(before - token.balanceOf(address(dist)), paid);
    }
}

contract KickbackPushInvariant is StdInvariant, Fixture {
    PushHandler internal handler;
    PoolId internal id;

    function setUp() public override {
        super.setUp();
        address a = address(0x1111);
        address b = address(0x2222);
        (, id) = _launch(1);
        vm.warp(vm.getBlockTimestamp() + 10);
        _buy(id, 1_000 ether);
        (,,,,, uint40 launchTime,) = d.hook.config(id);
        if (vm.getBlockTimestamp() < uint256(launchTime) + 1 hours) vm.warp(uint256(launchTime) + 1 hours);
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, 3 ether);
        assertEq(epoch, 1);
        (address coin,,,,,,) = d.hook.config(id);
        bytes32 leafA = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(block.chainid, address(d.distributor), coin, address(whype), epoch, a, uint256(1 ether))
                )
            )
        );
        bytes32 leafB = keccak256(
            bytes.concat(
                keccak256(
                    abi.encode(block.chainid, address(d.distributor), coin, address(whype), epoch, b, uint256(2 ether))
                )
            )
        );
        bytes32 root = leafA < leafB ? keccak256(abi.encode(leafA, leafB)) : keccak256(abi.encode(leafB, leafA));
        vm.prank(publisher);
        d.distributor.postRoot(id, epoch, root, keccak256("manifest"));
        vm.warp(block.timestamp + C.REVIEW_WINDOW + 1);
        handler = new PushHandler(d.distributor, whype, id, a, b, 1 ether, 2 ether, leafA, leafB);
        vm.prank(admin);
        d.distributor.setKeeper(address(handler));
        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](2);
        sels[0] = handler.pushA.selector;
        sels[1] = handler.pushB.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    function invariant_nothingLostOrPaidTwice() public view {
        assertEq(whype.balanceOf(address(d.distributor)), d.distributor.liabilities(address(whype)));
        assertLe(handler.paidOut(), 3 ether);
        (uint128 funded, uint128 claimed,,,,,,) = d.distributor.epochs(id, 1);
        assertLe(claimed, funded);
        if (d.distributor.claimed(id, 1, address(0x1111))) {
            assertEq(whype.balanceOf(address(0x1111)), 1 ether);
        }
        if (d.distributor.claimed(id, 1, address(0x2222))) {
            assertEq(whype.balanceOf(address(0x2222)), 2 ether);
        }
    }
}
