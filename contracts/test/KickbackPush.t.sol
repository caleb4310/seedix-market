// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {KickTree} from "./utils/KickTree.sol";
import {KickbackDistributor} from "../src/kickback/KickbackDistributor.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract PushCode {}

/// @notice Pair token that reverts transfers to one recipient and succeeds for everyone else.
contract SelectiveBlacklist {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;
    uint256 public totalSupply;
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == owner, "owner");
        totalSupply += amount;
        balanceOf[to] += amount;
    }

    function setBlocked(address account, bool value) external {
        require(msg.sender == owner, "owner");
        blocked[account] = value;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "allowance");
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (blocked[to]) revert("blocked");
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract KickbackPushTest is Fixture {
    PoolId internal id;
    address internal coin;
    address internal holder = makeAddr("holder");
    address internal other = makeAddr("other");
    PushCode internal codeHolder;
    uint256 internal tlNonce;

    function setUp() public override {
        super.setUp();
        codeHolder = new PushCode();
        (coin, id) = _launch(1);
    }

    function test_pushPaysHolderOnce() public {
        (uint64 epoch, uint256 amount) = _openSingle(holder, 1 ether);
        uint256 before = whype.balanceOf(holder);
        _push(epoch, holder, amount, new bytes32[](0));
        assertEq(whype.balanceOf(holder) - before, amount);
        assertEq(d.distributor.claimable(id, epoch, holder), 0);
        vm.expectRevert(KickbackDistributor.AlreadyClaimed.selector);
        _push(epoch, holder, amount, new bytes32[](0));
        vm.expectRevert(KickbackDistributor.AlreadyClaimed.selector);
        d.distributor.claim(id, epoch, holder, amount, new bytes32[](0));
        _assertConserves(epoch);
    }

    function test_pushBeforeReviewReverts() public {
        _accrue();
        (uint64 epoch,) = _fund();
        uint256 amount = 1 ether;
        bytes32 root = _leaf(epoch, holder, amount);
        vm.prank(publisher);
        d.distributor.postRoot(id, epoch, root, keccak256("manifest"));
        vm.expectRevert(KickbackDistributor.ReviewOpen.selector);
        _push(epoch, holder, amount, new bytes32[](0));
    }

    function test_onlyKeeperPushes() public {
        (uint64 epoch, uint256 amount) = _openSingle(holder, 1 ether);
        vm.prank(holder);
        vm.expectRevert(KickbackDistributor.NotKeeper.selector);
        d.distributor.push(id, epoch, _one(holder), _oneAmt(amount), _oneProof(new bytes32[](0)));
    }

    function test_batchIsBounded() public {
        address[] memory accounts = new address[](33);
        uint256[] memory amounts = new uint256[](33);
        bytes32[][] memory proofs = new bytes32[][](33);
        vm.expectRevert(KickbackDistributor.Batch.selector);
        d.distributor.push(id, 1, accounts, amounts, proofs);
        vm.expectRevert(KickbackDistributor.Batch.selector);
        d.distributor.push(id, 1, new address[](0), new uint256[](0), new bytes32[][](0));
    }

    function test_dustRollsIntoNextRound() public {
        _accrue();
        (uint64 epoch,) = _fund();
        uint256 dust = d.distributor.dustThreshold() - 1;
        _postSingle(epoch, holder, dust);
        _passReview();
        _push(epoch, holder, dust, new bytes32[](0));
        assertEq(whype.balanceOf(holder), 0);
        d.distributor.seal(id, epoch);
        assertTrue(d.distributor.holderSettled(id, epoch));
        KickbackDistributor.Round memory round = d.distributor.roundOf(id, epoch);
        assertEq(round.pushed + round.claimable + round.rollover, round.funded - round.gasPaid);
        uint256 carry = d.distributor.poolCarry(id);
        assertEq(carry, round.rollover);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(publisher);
        uint64 next = d.distributor.fund(id, 0);
        assertEq(d.distributor.roundOf(id, next).funded, carry);
        assertEq(d.distributor.poolCarry(id), 0);
        _assertConserves(epoch);
        _assertConserves(next);
        _assertSolvent();
    }

    function test_skipsContractsPoolAndHook() public {
        _accrue();
        (uint64 epoch,) = _fund();
        uint256 amount = 1 ether;
        address skipped = address(codeHolder);
        _postSingle(epoch, skipped, amount);
        _passReview();
        uint256 carryBefore = d.distributor.poolCarry(id);
        _push(epoch, skipped, amount, new bytes32[](0));
        assertEq(whype.balanceOf(skipped), 0);
        assertEq(d.distributor.poolCarry(id) - carryBefore, amount);
        assertTrue(d.distributor.isSkipped(id, address(pm)));
        assertTrue(d.distributor.isSkipped(id, address(d.hook)));
        assertTrue(d.distributor.isSkipped(id, address(d.locker)));
        assertTrue(d.distributor.claimed(id, epoch, skipped));
        _assertConserves(epoch);
    }

    function test_teamWalletAlwaysSkipped() public {
        address team = address(codeHolder);
        (address teamCoin, PoolId teamPool) = d.launcher.launch(_params(address(whype), 1, 500, team));
        coin = teamCoin;
        id = teamPool;
        _accrue();
        (uint64 epoch,) = _fund();
        _timelock(address(d.distributor), abi.encodeCall(d.distributor.setAllowlist, (team, true)));
        assertTrue(d.distributor.allowlisted(team));
        uint256 amount = 1 ether;
        _postSingle(epoch, team, amount);
        _passReview();
        _push(epoch, team, amount, new bytes32[](0));
        assertEq(whype.balanceOf(team), 0);
        assertEq(d.distributor.rolloverEpoch(id, epoch), amount);
        assertTrue(d.distributor.isSkipped(id, team));
    }

    function test_allowlistedContractIsPaid() public {
        address payee = address(new PushCode());
        _timelock(address(d.distributor), abi.encodeCall(d.distributor.setAllowlist, (payee, true)));
        (uint64 epoch, uint256 amount) = _openSingle(payee, 1 ether);
        _push(epoch, payee, amount, new bytes32[](0));
        assertEq(whype.balanceOf(payee), amount);
        _assertConserves(epoch);
    }

    function test_revertingReceiverDoesNotBlockBatch() public {
        SelectiveBlacklist token = new SelectiveBlacklist();
        token.mint(address(this), 1_000_000 ether);
        _timelock(address(d.launcher), abi.encodeCall(d.launcher.setPairAllowed, (address(token), true)));
        token.mint(address(this), 4 ether);
        _openRoute(address(token));
        token.approve(address(router), type(uint256).max);
        (address launched, PoolId pool) = d.launcher.launch(_params(address(token), 1, 0, address(0)));
        coin = launched;
        id = pool;
        _accrue();
        (uint64 epoch,) = _fund();
        uint256 goodAmt = 1 ether;
        uint256 badAmt = 1 ether;
        bytes32 goodLeaf = _leaf(epoch, holder, goodAmt);
        bytes32 badLeaf = _leaf(epoch, other, badAmt);
        bytes32 root = KickTree.pairHash(goodLeaf, badLeaf);
        vm.prank(publisher);
        d.distributor.postRoot(id, epoch, root, keccak256("manifest"));
        _passReview();
        token.setBlocked(other, true);

        address[] memory accounts = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        bytes32[][] memory proofs = new bytes32[][](2);
        accounts[0] = other;
        amounts[0] = badAmt;
        proofs[0] = new bytes32[](1);
        proofs[0][0] = goodLeaf;
        accounts[1] = holder;
        amounts[1] = goodAmt;
        proofs[1] = new bytes32[](1);
        proofs[1][0] = badLeaf;
        d.distributor.push(id, epoch, accounts, amounts, proofs);

        assertEq(token.balanceOf(other), 0);
        assertEq(d.distributor.claimable(id, epoch, other), badAmt);
        assertEq(token.balanceOf(holder), goodAmt);
        _assertConserves(epoch);

        token.setBlocked(other, false);
        vm.prank(other);
        d.distributor.claimFailed(id, epoch);
        assertEq(token.balanceOf(other), badAmt);
        assertEq(d.distributor.claimable(id, epoch, other), 0);
        vm.prank(other);
        vm.expectRevert(KickbackDistributor.AlreadyClaimed.selector);
        d.distributor.claim(id, epoch, other, badAmt, proofs[0]);
        _assertConserves(epoch);
        assertEq(token.balanceOf(address(d.distributor)), d.distributor.liabilities(address(token)));
    }

    function test_pausedPushCreditsClaimable() public {
        _accrue();
        (uint64 epoch,) = _fund();
        uint256 a = 1 ether;
        uint256 b = 2 ether;
        bytes32 leafA = _leaf(epoch, holder, a);
        bytes32 leafB = _leaf(epoch, other, b);
        vm.prank(publisher);
        d.distributor.postRoot(id, epoch, KickTree.pairHash(leafA, leafB), keccak256("manifest"));
        _passReview();
        whype.pause();
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
        d.distributor.push(id, epoch, accounts, amounts, proofs);
        whype.unpause();
        assertEq(whype.balanceOf(holder), 0);
        assertEq(d.distributor.claimable(id, epoch, holder), a);
        assertEq(d.distributor.claimable(id, epoch, other), b);
        vm.prank(holder);
        d.distributor.claimFailed(id, epoch);
        vm.prank(other);
        d.distributor.claimFailed(id, epoch);
        assertEq(whype.balanceOf(holder), a);
        assertEq(whype.balanceOf(other), b);
        d.distributor.seal(id, epoch);
        assertTrue(d.distributor.holderSettled(id, epoch));
        _assertSolvent();
    }

    function test_gasCapBindsAndStays() public {
        _accrue();
        (uint64 epoch,) = _fund();
        uint256 a = 1 ether;
        uint256 b = 1 ether;
        bytes32 leafA = _leaf(epoch, holder, a);
        bytes32 leafB = _leaf(epoch, other, b);
        vm.prank(publisher);
        d.distributor.postRoot(id, epoch, KickTree.pairHash(leafA, leafB), keccak256("manifest"));
        _passReview();
        vm.txGasPrice(100_000 gwei);
        uint256 keeperBefore = whype.balanceOf(address(this));
        _push(epoch, holder, a, _sibling(leafB));
        KickbackDistributor.Round memory round = d.distributor.roundOf(id, epoch);
        uint256 cap = round.funded * 200 / 10_000;
        assertEq(round.gasPaid, cap);
        assertEq(whype.balanceOf(address(this)) - keeperBefore, cap);
        _push(epoch, other, b, _sibling(leafA));
        assertEq(d.distributor.gasPaidEpoch(id, epoch), cap);
        _assertConserves(epoch);
        d.distributor.seal(id, epoch);
        assertTrue(d.distributor.holderSettled(id, epoch));
    }

    function test_gasCapIsConfigurableOnlyOnTestnet() public {
        vm.prank(address(0xB0B));
        vm.expectRevert(KickbackDistributor.NotTimelock.selector);
        d.distributor.setGasCapBps(10);

        vm.prank(admin);
        vm.expectRevert(KickbackDistributor.Cap.selector);
        d.distributor.setGasCapBps(201);

        vm.prank(admin);
        d.distributor.setGasCapBps(50);
        assertEq(d.distributor.gasCapBps(), 50);
        vm.prank(admin);
        vm.expectRevert(KickbackDistributor.Cap.selector);
        d.distributor.setGasCapBps(50);

        _timelock(address(d.distributor), abi.encodeCall(d.distributor.setGasCapBps, (200)));
        assertEq(d.distributor.gasCapBps(), 200);

        vm.chainId(99801);
        vm.prank(admin);
        d.distributor.setGasCapBps(25);
        assertEq(d.distributor.gasCapBps(), 25);

        vm.chainId(99901);
        vm.prank(admin);
        vm.expectRevert(KickbackDistributor.GasCapFixed.selector);
        d.distributor.setGasCapBps(1);
        vm.prank(address(d.roles.timelock()));
        vm.expectRevert(KickbackDistributor.GasCapFixed.selector);
        d.distributor.setGasCapBps(1);
    }

    function test_cancelAfterPushReverts() public {
        (uint64 epoch, uint256 amount) = _openSingle(holder, 1 ether);
        _push(epoch, holder, amount, new bytes32[](0));
        vm.prank(admin);
        vm.expectRevert(KickbackDistributor.BadEpoch.selector);
        d.distributor.cancel(id, epoch);
    }

    function testFuzz_conservation(uint96 rawPay, uint96 rawDust, uint256 price) public {
        price = bound(price, 0, 200 gwei);
        vm.txGasPrice(price);
        _accrue();
        (uint64 epoch, uint128 pot) = _fund();
        uint256 budget = d.distributor.holderBudget(id, epoch);
        uint256 dustLine = d.distributor.dustThreshold();
        vm.assume(budget > dustLine * 2);
        vm.assume(pot > 0);
        uint256 dustAmt = bound(rawDust, 1, dustLine - 1);
        uint256 pay = bound(rawPay, dustLine, budget - dustAmt);
        bytes32 payLeaf = _leaf(epoch, holder, pay);
        bytes32 dustLeaf = _leaf(epoch, other, dustAmt);
        vm.prank(publisher);
        d.distributor.postRoot(id, epoch, KickTree.pairHash(payLeaf, dustLeaf), keccak256("manifest"));
        _passReview();
        uint256 keeperBefore = whype.balanceOf(address(this));
        address[] memory accounts = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        bytes32[][] memory proofs = new bytes32[][](2);
        accounts[0] = holder;
        amounts[0] = pay;
        proofs[0] = _sibling(dustLeaf);
        accounts[1] = other;
        amounts[1] = dustAmt;
        proofs[1] = _sibling(payLeaf);
        d.distributor.push(id, epoch, accounts, amounts, proofs);
        d.distributor.seal(id, epoch);
        KickbackDistributor.Round memory round = d.distributor.roundOf(id, epoch);
        assertEq(round.pending, 0);
        assertEq(round.pushed + round.claimable + round.rollover, round.funded - round.gasPaid);
        assertLe(round.gasPaid, round.funded * 200 / 10_000);
        assertLe(round.gasPaid, round.funded * d.distributor.gasCapBps() / 10_000);
        assertEq(whype.balanceOf(holder), pay);
        assertEq(whype.balanceOf(other), 0);
        assertEq(whype.balanceOf(address(this)) - keeperBefore, round.gasPaid);
        assertTrue(d.distributor.holderSettled(id, epoch));
        _assertSolvent();
    }

    function testFuzz_noDoublePay(uint96 raw) public {
        _accrue();
        (uint64 epoch,) = _fund();
        uint256 budget = d.distributor.holderBudget(id, epoch);
        uint256 dustLine = d.distributor.dustThreshold();
        vm.assume(budget > dustLine);
        uint256 amount = bound(raw, dustLine, budget);
        _postSingle(epoch, holder, amount);
        _passReview();
        _push(epoch, holder, amount, new bytes32[](0));
        uint256 bal = whype.balanceOf(holder);
        vm.expectRevert(KickbackDistributor.AlreadyClaimed.selector);
        _push(epoch, holder, amount, new bytes32[](0));
        vm.expectRevert(KickbackDistributor.AlreadyClaimed.selector);
        d.distributor.claim(id, epoch, holder, amount, new bytes32[](0));
        assertEq(whype.balanceOf(holder), bal);
        assertEq(d.distributor.claimable(id, epoch, holder), 0);
        _assertConserves(epoch);
    }

    function testFuzz_skipsCode(address account) public {
        vm.assume(account.code.length == 0);
        vm.assume(uint160(account) > 0xffff);
        vm.assume(account != address(this) && account != admin && account != publisher && account != creator);
        vm.assume(account != holder && account != other);
        vm.assume(account != address(d.hook) && account != address(d.distributor) && account != address(d.executor));
        vm.assume(account != address(d.locker) && account != address(d.vault) && account != address(d.launcher));
        vm.assume(account != address(pm) && account != address(whype) && account != address(router));
        vm.assume(account != address(codeHolder));
        vm.etch(account, hex"fe");
        _accrue();
        (uint64 epoch,) = _fund();
        uint256 amount = 1 ether;
        if (amount > d.distributor.holderBudget(id, epoch)) amount = d.distributor.holderBudget(id, epoch);
        vm.assume(amount >= d.distributor.dustThreshold());
        _postSingle(epoch, account, amount);
        _passReview();
        uint256 before = whype.balanceOf(account);
        _push(epoch, account, amount, new bytes32[](0));
        assertEq(whype.balanceOf(account), before);
        assertEq(d.distributor.claimable(id, epoch, account), 0);
        assertGe(d.distributor.rolloverEpoch(id, epoch), amount);
        _assertConserves(epoch);
    }

    function _accrue() internal {
        vm.warp(vm.getBlockTimestamp() + 10);
        _buy(id, 2_000 ether);
        (,,,,, uint40 launchTime,) = d.hook.config(id);
        uint256 closed = uint256(launchTime) + 1 hours;
        if (vm.getBlockTimestamp() < closed) vm.warp(closed);
    }

    function _fund() internal returns (uint64 epoch, uint128 pot) {
        (,, pot,,) = d.hook.pots(id);
        vm.prank(publisher);
        epoch = d.distributor.fund(id, pot);
    }

    function _openSingle(address account, uint256 amount) internal returns (uint64 epoch, uint256) {
        _accrue();
        (epoch,) = _fund();
        _postSingle(epoch, account, amount);
        _passReview();
        return (epoch, amount);
    }

    function _postSingle(uint64 epoch, address account, uint256 amount) internal {
        bytes32 root = _leaf(epoch, account, amount);
        vm.prank(publisher);
        d.distributor.postRoot(id, epoch, root, keccak256("manifest"));
    }

    function _passReview() internal {
        vm.warp(block.timestamp + 1 hours + 1);
    }

    function _leaf(uint64 epoch, address account, uint256 amount) internal view returns (bytes32) {
        return KickTree.leaf(block.chainid, address(d.distributor), coin, _pair(), epoch, account, amount);
    }

    function _pair() internal view returns (address) {
        (, Currency pair,,,,,) = d.hook.config(id);
        return Currency.unwrap(pair);
    }

    function _push(uint64 epoch, address account, uint256 amount, bytes32[] memory proof) internal {
        d.distributor.push(id, epoch, _one(account), _oneAmt(amount), _oneProof(proof));
    }

    function _one(address account) internal pure returns (address[] memory a) {
        a = new address[](1);
        a[0] = account;
    }

    function _oneAmt(uint256 amount) internal pure returns (uint256[] memory a) {
        a = new uint256[](1);
        a[0] = amount;
    }

    function _oneProof(bytes32[] memory proof) internal pure returns (bytes32[][] memory proofs) {
        proofs = new bytes32[][](1);
        proofs[0] = proof;
    }

    function _sibling(bytes32 leafHash) internal pure returns (bytes32[] memory proof) {
        proof = new bytes32[](1);
        proof[0] = leafHash;
    }

    function _timelock(address target, bytes memory data) internal {
        TimelockController tl = d.roles.timelock();
        bytes32 salt = keccak256(abi.encode("seedix.push", data, ++tlNonce));
        uint256 delay = tl.getMinDelay();
        vm.prank(admin);
        tl.schedule(target, 0, data, bytes32(0), salt, delay);
        vm.warp(block.timestamp + delay + 1);
        vm.prank(admin);
        tl.execute(target, 0, data, bytes32(0), salt);
    }

    function _assertConserves(uint64 epoch) internal view {
        assertTrue(d.distributor.conserves(id, epoch));
        KickbackDistributor.Round memory round = d.distributor.roundOf(id, epoch);
        assertEq(round.pushed + round.claimable + round.rollover + round.gasPaid + round.pending, round.funded);
    }

    function _assertSolvent() internal view {
        address token = _pair();
        assertEq(IERC20(token).balanceOf(address(d.distributor)), d.distributor.liabilities(token));
    }
}
