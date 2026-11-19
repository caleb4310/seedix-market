// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Origin} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import {MessagingFee, SendParam} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {Fixture} from "../utils/Fixture.sol";
import {SeedixConstants as C} from "../../src/libraries/SeedixConstants.sol";
import {LaunchToken} from "../../src/token/LaunchToken.sol";
import {MockXStock} from "../../src/token/MockXStock.sol";
import {RouteSeeder} from "../../src/launch/RouteSeeder.sol";
import {MockZRO} from "../../src/zro/MockZRO.sol";
import {OftRecipient} from "../../src/zro/OftRecipient.sol";
import {SafeOps} from "../../src/zro/SafeOps.sol";
import {UlnPolicy} from "../../src/zro/UlnPolicy.sol";
import {ZroPayout} from "../../src/zro/ZroPayout.sol";
import {ZroRewardVault} from "../../src/zro/ZroRewardVault.sol";
import {ZroWeightTracker} from "../../src/zro/ZroWeightTracker.sol";
import {ZroGraduation} from "../../src/zro/ZroGraduation.sol";
import {ZroCoinAdapter} from "../../src/zro/ZroCoinAdapter.sol";
import {ZroRemoteOFT} from "../../src/zro/ZroRemoteOFT.sol";
import {TestLzEndpoint} from "../zro/TestLzEndpoint.sol";

contract PolicyProbe {
    function check(address[] memory required, address labs) external pure {
        UlnPolicy.assertDvns(required, labs);
    }
}

contract FakeToken {
    function hit(ZroWeightTracker t, address victim) external {
        t.onTransfer(address(0), victim, 1);
    }
}

/// Sentinel re-check of PR 33, rewritten so each case passes because the fix holds.
contract RecheckVault is Fixture {
    uint32 internal constant DST = 2;
    TestLzEndpoint internal endpoint;
    MockZRO internal zro;
    MockZRO internal remote;
    ZroRewardVault internal vault;
    ZroPayout internal payout;
    ZroWeightTracker internal tracker;
    address internal coin;
    PoolId internal id;
    address internal alice = address(0xA11CE1);
    address internal bob = address(0xB0B1);
    uint64 internal epoch;

    function setUp() public override {
        super.setUp();
        vm.warp(2 days);
        tracker = new ZroWeightTracker(address(this), address(d.hook), address(router), address(pm));
        tracker.setTimelock(address(d.timelock));
        (coin, id) = _launch(0);
        tracker.registerCoin(coin);
        epoch = uint64(vm.getBlockTimestamp() / 1 hours);
        endpoint = new TestLzEndpoint(1, 0.01 ether);
        zro = new MockZRO(address(endpoint), address(this), address(this));
        remote = new MockZRO(address(endpoint), address(this), address(this));
        zro.setPeer(DST, bytes32(uint256(uint160(address(remote)))));
        remote.setPeer(1, bytes32(uint256(uint160(address(zro)))));
        vault =
            new ZroRewardVault(address(this), address(this), address(d.timelock), address(this), zro, d.hook, tracker);
        payout = new ZroPayout(address(vault));
        vm.prank(address(d.timelock));
        vault.setPayoutModule(address(payout));
        vault.setSwapper(address(this));
        zro.mint(address(this), 100 ether);
        zro.approve(address(vault), type(uint256).max);
    }

    function _grad() internal returns (ZroGraduation g) {
        g = new ZroGraduation(
            address(endpoint), address(this), address(d.timelock), address(tracker), address(d.launcher)
        );
    }

    function test_R_M01_graduateRevertsWithoutExcluderRights() public {
        ZroGraduation g = _grad();
        vm.expectRevert(ZroGraduation.CannotExclude.selector);
        g.graduate(coin);
        vm.prank(address(d.timelock));
        tracker.setExcluder(address(g));
        address a = g.graduate(coin);
        assertTrue(tracker.excludedFrom(coin, a));
        vm.expectRevert(ZroGraduation.NotSeedixCoin.selector);
        g.graduate(address(0xC01));
    }

    function test_R_NEW_M01_tokensOfPoisoningBricksGraduation() public {
        ZroGraduation g = _grad();
        vm.prank(address(d.timelock));
        tracker.setExcluder(address(g));
        address predicted = vm.computeCreateAddress(address(g), vm.getNonce(address(g)));
        for (uint256 i; i < 8; ++i) {
            FakeToken fake = new FakeToken();
            vm.expectRevert(ZroWeightTracker.NotCoin.selector);
            fake.hit(tracker, predicted);
        }
        uint256 g0 = gasleft();
        address adapter = g.graduate(coin);
        uint256 used = g0 - gasleft();
        assertLt(used, 4_000_000);
        assertEq(adapter, predicted);
        assertTrue(tracker.excludedFrom(coin, adapter));
    }

    function test_R_NEW_info_firstReceiveGasOverhead() public {
        vm.prank(coin);
        tracker.onTransfer(address(0), alice, 1 ether);
        vm.prank(coin);
        uint256 g0 = gasleft();
        tracker.onTransfer(alice, bob, 1);
        assertLt(g0 - gasleft(), 150_000);
    }

    function test_R_L01_lateExclusionNoLongerInflates() public {
        address adapter = address(0xADA7);
        vm.startPrank(coin);
        tracker.onTransfer(address(0), alice, 5 ether);
        tracker.onTransfer(alice, adapter, 4 ether);
        vm.stopPrank();
        tracker.setExcluded(adapter, coin, true);
        assertEq(tracker.eligibleSupply(coin), 1 ether);
        vm.prank(coin);
        tracker.onTransfer(adapter, bob, 4 ether);
        assertEq(tracker.eligibleSupply(coin), 5 ether);
    }

    function test_R_NEW_L01_unexcludeBackdatesWeight() public {
        vm.startPrank(coin);
        tracker.onTransfer(address(0), alice, 5 ether);
        tracker.onTransfer(address(0), bob, 5 ether);
        vm.stopPrank();
        tracker.setExcluded(alice, coin, true);
        vm.warp(vm.getBlockTimestamp() + 30 minutes);
        tracker.setExcluded(alice, coin, false);
        vm.warp(vm.getBlockTimestamp() + 30 minutes - 1);
        vm.prank(coin);
        tracker.onTransfer(alice, bob, 1);
        vm.warp(vm.getBlockTimestamp() + 1);
        uint64 s = epoch * 3600;
        uint256 wa = tracker.weight(coin, alice, s, s + 3600);
        uint256 wb = tracker.weight(coin, bob, s, s + 3600);
        uint256 tw = tracker.totalWeight(coin, s, s + 3600);
        assertEq(wa + wb, tw);
        vault.fund(id, epoch, 1 ether);
        vm.prank(alice);
        vault.claim(id, epoch);
        vm.prank(bob);
        vault.claim(id, epoch);
        assertLe(vault.totalClaimed(), vault.totalFunded());
    }

    function test_R_L02_expiryAndRetroactiveShortening() public {
        vm.startPrank(coin);
        tracker.onTransfer(address(0), alice, 5 ether);
        tracker.onTransfer(address(0), bob, 5 ether);
        vm.stopPrank();
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vault.fund(id, epoch, 1 ether);
        vm.prank(alice);
        vault.claim(id, epoch);
        vm.prank(address(d.timelock));
        vault.setClaimWindow(1 hours);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vm.expectRevert(ZroRewardVault.Early.selector);
        vault.expireRound(id, epoch);
        vm.warp(vm.getBlockTimestamp() + 90 days);
        vault.expireRound(id, epoch);
        assertEq(vault.pendingDust(), 0.5 ether);
        vm.prank(bob);
        vm.expectRevert(ZroRewardVault.Overflow.selector);
        vault.claim(id, epoch);
        assertEq(zro.balanceOf(address(this)), 99 ether);
    }

    function test_R_L03_bytes32RecipientAndRefunds() public {
        vm.prank(coin);
        tracker.onTransfer(address(0), alice, 5 ether);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        uint256 amt = 1 ether + 123_456_789;
        vault.fund(id, epoch, amt);
        bytes32 to = bytes32(uint256(uint160(bob)));
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(ZroRewardVault.ZeroAddress.selector);
        vault.claimRemote{value: 0.02 ether}(id, epoch, DST, bytes32(0), "");
        uint256 fee = vault.quoteRemote(to, amt, DST, "");
        vm.prank(alice);
        vault.claimRemote{value: fee + 7}(id, epoch, DST, to, "");
        endpoint.deliverLast();
        uint256 dust = amt % 1e12;
        assertEq(remote.balanceOf(bob), amt - dust);
        assertEq(zro.balanceOf(alice), dust);
        assertEq(alice.balance, 1 ether - fee);
        assertEq(vault.totalClaimed(), vault.totalFunded());
    }

    function test_R_info_highBitsRecipientBurns() public {
        vm.prank(coin);
        tracker.onTransfer(address(0), alice, 5 ether);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vault.fund(id, epoch, 1 ether);
        bytes32 to = bytes32(uint256(1) << 200);
        vm.expectRevert(ZroRewardVault.BadRecipient.selector);
        vault.quoteRemote(to, 1 ether, DST, "");
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(ZroRewardVault.BadRecipient.selector);
        vault.claimRemote{value: 0.02 ether}(id, epoch, DST, to, "");
        assertEq(remote.balanceOf(address(0xdead)), 0);
    }

    function test_R_NEW_L02_excludingTeamDoubleSubtracts() public {
        LaunchToken impl = new LaunchToken();
        LaunchToken c2 = LaunchToken(Clones.clone(address(impl)));
        tTracker = tracker;
        tracker.setExcluded(address(this), true);
        address team = address(0x7EA);
        uint256 teamAmt = C.SUPPLY * C.MAX_TEAM_BPS / 10_000;
        tracker.registerCoin(address(c2));
        c2.initialize("C", "C", address(this), C.SUPPLY - teamAmt, team, teamAmt);
        c2.transfer(alice, teamAmt * 2);
        assertEq(tracker.eligibleSupply(address(c2)), teamAmt * 2);
        tracker.setExcluded(team, true);
        tracker.setExcluded(team, address(c2), true);
        assertEq(tracker.eligibleSupply(address(c2)), teamAmt * 2);
    }

    ZroWeightTracker internal tTracker;

    function zroWeightTracker() external view returns (address) {
        return address(tTracker);
    }

    function _tail(bytes memory data) internal pure returns (bytes memory rest) {
        rest = new bytes(data.length - 4);
        for (uint256 i; i < rest.length; ++i) {
            rest[i] = data[i + 4];
        }
    }

    function test_R_NEW_L03_adapterConstructorCheckBypass() public {
        vm.expectRevert();
        new ZroCoinAdapter(coin, address(endpoint), address(this), address(this));
    }

    function test_L05_setDelegateIsTimelockOnly() public {
        ZroGraduation g = _grad();
        vm.prank(address(d.timelock));
        tracker.setExcluder(address(g));
        ZroCoinAdapter adapter = ZroCoinAdapter(g.graduate(coin));
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        adapter.setDelegate(address(0xBEEF));
        vm.prank(address(d.timelock));
        adapter.setDelegate(address(d.timelock));
    }

    function test_I01_ulnPolicyAndOnePeerSchedule() public {
        address labs = address(0x1111);
        address other = address(0x2222);
        address[] memory onlyLabs = new address[](2);
        onlyLabs[0] = labs;
        onlyLabs[1] = address(uint160(uint160(labs) + 1));
        // sorted: labs then labs+1, and labs+1 is the outsider, so this one is valid.
        UlnPolicy.assertDvns(onlyLabs, labs);
        address[] memory labsTwice = new address[](2);
        labsTwice[0] = address(0x1000);
        labsTwice[1] = labs;
        // 0x1000 < labs. Both must not be only the labs address. 0x1000 is an outsider. Valid.
        UlnPolicy.assertDvns(labsTwice, labs);
        PolicyProbe probe = new PolicyProbe();
        address[] memory one = new address[](1);
        one[0] = other;
        vm.expectRevert(UlnPolicy.UlnPolicyFailed.selector);
        probe.check(one, labs);
        address[] memory same = new address[](2);
        same[0] = labs;
        same[1] = labs;
        vm.expectRevert(UlnPolicy.UlnPolicyFailed.selector);
        probe.check(same, labs);

        bytes memory scheduled = SafeOps.peerSchedule(address(0xA), 2, address(0xB), bytes32(uint256(3)), 48 hours);
        (address target,, bytes memory inner,,,) =
            abi.decode(_tail(scheduled), (address, uint256, bytes, bytes32, bytes32, uint256));
        assertEq(target, address(0xA));
        (, bytes32 peer) = abi.decode(_tail(inner), (uint32, bytes32));
        assertEq(peer, bytes32(uint256(uint160(address(0xB)))));
    }
}

/// M-04: two-chain round trip with ZroRemoteOFT. Invariant: locked == remote supply.
contract RecheckBridge is Fixture {
    function test_R_M04_roundTripKeepsLockedEqualRemoteSupply() public {
        (address coinA, PoolId pid) = _launch(0);
        LaunchToken coin = LaunchToken(coinA);
        TestLzEndpoint home = new TestLzEndpoint(1, 0.01 ether);
        TestLzEndpoint away = new TestLzEndpoint(2, 0.01 ether);
        ZroGraduation g =
            new ZroGraduation(address(home), address(this), address(d.timelock), address(0), address(d.launcher));
        ZroCoinAdapter adapter = ZroCoinAdapter(g.graduate(coinA));
        ZroRemoteOFT r = new ZroRemoteOFT("C", "C", address(away), address(this), address(d.timelock), 48 hours);
        vm.startPrank(address(d.timelock));
        adapter.setPeer(2, bytes32(uint256(uint160(address(r)))));
        r.setPeer(1, bytes32(uint256(uint160(address(adapter)))));
        vm.stopPrank();
        vm.expectRevert();
        r.lzReceive(Origin(1, bytes32(uint256(uint160(address(adapter)))), 1), bytes32(0), "", address(0), "");

        _buy(pid, 50 ether);
        uint256 bal = coin.balanceOf(address(this));
        coin.approve(address(adapter), bal);
        SendParam memory bad = SendParam(2, bytes32(0), bal, 0, "", "", "");
        vm.expectRevert(OftRecipient.BadRecipient.selector);
        adapter.quoteSend(bad, false);
        bad.to = bytes32(uint256(1) << 200);
        vm.expectRevert(OftRecipient.BadRecipient.selector);
        adapter.quoteSend(bad, false);
        _send(address(adapter), 2, bal);
        bytes32 g1 = home.lastGuid();
        bytes memory m1 = home.lastMessage();
        vm.prank(address(away));
        r.lzReceive(Origin(1, bytes32(uint256(uint160(address(adapter)))), 1), g1, m1, address(0), "");
        assertEq(r.totalSupply(), coin.balanceOf(address(adapter)));
        assertEq(r.totalSupply(), bal - bal % 1e12);
        uint256 back = r.balanceOf(address(this)) / 2 / 1e12 * 1e12;
        _send(address(r), 1, back);
        assertEq(r.totalSupply(), coin.balanceOf(address(adapter)) - back);
        bytes32 g2 = away.lastGuid();
        bytes memory m2 = away.lastMessage();
        vm.prank(address(home));
        adapter.lzReceive(Origin(2, bytes32(uint256(uint160(address(r)))), 1), g2, m2, address(0), "");
        assertEq(r.totalSupply(), coin.balanceOf(address(adapter)));
    }

    function test_I04_remoteSweepIsTimelockOnly() public {
        TestLzEndpoint away = new TestLzEndpoint(2, 0.01 ether);
        ZroRemoteOFT r = new ZroRemoteOFT("C", "C", address(away), address(this), address(d.timelock), 48 hours);
        vm.deal(address(r), 1 ether);
        vm.expectRevert(ZroRemoteOFT.NotTimelock.selector);
        r.sweep(payable(address(this)));
        vm.prank(address(d.timelock));
        r.sweep(payable(address(0xBEEF)));
        assertEq(address(0xBEEF).balance, 1 ether);
    }

    function _send(address oft, uint32 dst, uint256 amt) internal {
        SendParam memory p = SendParam(dst, bytes32(uint256(uint160(address(this)))), amt, 0, "", "", "");
        MessagingFee memory fee = ZroCoinAdapter(oft).quoteSend(p, false);
        ZroCoinAdapter(oft).send{value: fee.nativeFee}(p, fee, address(this));
    }
}

/// P32-M-01: closed.
contract RecheckSeeder is Test {
    function test_R_P32M01_ownerOnlyAndDeltaSpend() public {
        PoolManager pm = new PoolManager(address(0));
        MockXStock weth = new MockXStock("WETH", "WETH", 18, address(this));
        MockXStock zro = new MockXStock("ZRO", "ZRO", 18, address(this));
        RouteSeeder seeder = new RouteSeeder();
        weth.approve(address(seeder), 1000 ether);
        zro.approve(address(seeder), 1000 ether);
        vm.prank(address(0xBAD));
        vm.expectRevert(RouteSeeder.NotOwner.selector);
        seeder.seedWide(IPoolManager(address(pm)), address(weth), address(zro), 1e9, 1);
        uint256 before = weth.balanceOf(address(this));
        (, uint256 spent) = seeder.seedWide(IPoolManager(address(pm)), address(weth), address(zro), 10 ether, 1);
        assertGt(spent, 0);
        assertEq(before - weth.balanceOf(address(this)), spent);
        assertEq(weth.balanceOf(address(seeder)), 0);
    }
}
