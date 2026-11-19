// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Fixture} from "../utils/Fixture.sol";
import {SeedixConstants as C} from "../../src/libraries/SeedixConstants.sol";
import {LaunchToken} from "../../src/token/LaunchToken.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ZroGraduation} from "../../src/zro/ZroGraduation.sol";
import {ZroMainnetGuard} from "../../src/zro/ZroMainnetGuard.sol";
import {ZroPayout} from "../../src/zro/ZroPayout.sol";
import {ZroRewardVault} from "../../src/zro/ZroRewardVault.sol";
import {ZroWeightTracker} from "../../src/zro/ZroWeightTracker.sol";
import {TestLzEndpoint} from "../zro/TestLzEndpoint.sol";

contract CoinAllow {
    mapping(address => bool) public isLaunchedCoin;

    function allow(address coin) external {
        isLaunchedCoin[coin] = true;
    }
}

contract OldTracker {
    address public owner = address(1);

    function setExcluded(address, bool) external {}
}

contract Pr33FixTest is Fixture {
    function test_M01_graduateRevertsUnlessItCanExclude() public {
        (ZroWeightTracker tracker, CoinAllow list, address coin) = _coin();
        TestLzEndpoint endpoint = new TestLzEndpoint(1, 0.01 ether);
        ZroGraduation grad =
            new ZroGraduation(address(endpoint), address(this), address(d.timelock), address(tracker), address(list));
        vm.expectRevert(ZroGraduation.CannotExclude.selector);
        grad.graduate(coin);
    }

    function test_M02_oldTrackerRevertsWithAClearError() public {
        (, CoinAllow list, address coin) = _coin();
        TestLzEndpoint endpoint = new TestLzEndpoint(1, 0.01 ether);
        ZroGraduation grad = new ZroGraduation(
            address(endpoint), address(this), address(d.timelock), address(new OldTracker()), address(list)
        );
        vm.expectRevert(ZroGraduation.TrackerHasNoExcluder.selector);
        grad.graduate(coin);
    }

    function test_M03_teamWalletEarnsNoWeight() public {
        vm.warp(2 days);
        trackerForTeam = new ZroWeightTracker(address(this), address(0), address(0), address(0));
        trackerForTeam.setExcluded(address(this), true);
        LaunchToken coin = LaunchToken(Clones.clone(address(new LaunchToken())));
        address team = address(0x7EA);
        uint256 teamAmt = C.SUPPLY * C.MAX_TEAM_BPS / 10_000;
        coin.initialize("Coin", "C", address(this), C.SUPPLY - teamAmt, team, teamAmt);
        vm.warp(2 days + 1 hours);
        assertEq(trackerForTeam.weight(address(coin), team, uint64(2 days), uint64(2 days + 1 hours)), 0);
        assertEq(trackerForTeam.totalWeight(address(coin), uint64(2 days), uint64(2 days + 1 hours)), 0);
    }

    function zroWeightTracker() external view returns (address) {
        return address(trackerForTeam);
    }

    ZroWeightTracker internal trackerForTeam;

    function test_L01_excludingABalanceDoesNotInflateSupply() public {
        (ZroWeightTracker tracker,, address coin) = _coin();
        address adapter = address(0xADA7);
        address alice = address(0xA11CE);
        address bob = address(0xB0B);
        vm.startPrank(coin);
        tracker.onTransfer(address(0), alice, 5 ether);
        tracker.onTransfer(alice, adapter, 4 ether);
        vm.stopPrank();
        tracker.setExcluded(adapter, true);
        vm.prank(coin);
        tracker.onTransfer(adapter, bob, 4 ether);
        assertEq(tracker.eligibleSupply(coin), 5 ether);
    }

    function test_L02_expiredRoundRollsTheUnclaimedShareForward() public {
        vm.warp(2 days);
        ZroWeightTracker tracker = new ZroWeightTracker(address(this), address(d.hook), address(router), address(pm));
        (address coin, PoolId id) = _launch(0);
        ZroRewardVault vault = new ZroRewardVault(
            address(this), address(this), address(d.timelock), address(this), IERC20(_zro()), d.hook, tracker
        );
        vault.setSwapper(address(this));
        uint64 epoch = uint64(vm.getBlockTimestamp() / 1 hours);
        vm.startPrank(coin);
        tracker.onTransfer(address(0), address(0xA11CE), 5 ether);
        tracker.onTransfer(address(0), address(0xdead), 5 ether);
        vm.stopPrank();
        uint256 closed = vm.getBlockTimestamp() + 1 hours;
        vm.warp(closed);
        vault.fund(id, epoch, 1 ether);
        vm.prank(address(0xA11CE));
        vault.claim(id, epoch);
        assertEq(vault.liabilities(), 0.5 ether);
        vm.prank(address(d.timelock));
        vault.setClaimWindow(1 hours);
        vm.warp(closed + 1 hours);
        vault.expireRound(id, epoch);
        assertEq(vault.liabilities(), 0);
        assertEq(vault.pendingDust(), 0.5 ether);
    }

    function test_L03_remoteRecipientRejectsZero() public {
        ZroPayout payout = new ZroPayout(address(this));
        vm.expectRevert(ZroPayout.ZeroRecipient.selector);
        payout.quote(address(1), bytes32(0), 1 ether, 2, "");
    }

    function test_L04_onlyALaunchedCoinCanGraduate() public {
        (, CoinAllow list,) = _coin();
        TestLzEndpoint endpoint = new TestLzEndpoint(1, 0.01 ether);
        ZroGraduation grad =
            new ZroGraduation(address(endpoint), address(this), address(d.timelock), address(0), address(list));
        vm.expectRevert(ZroGraduation.NotSeedixCoin.selector);
        grad.graduate(address(0x1234));
    }

    function test_claimableMatchesThePullAmount() public {
        vm.warp(2 days);
        ZroWeightTracker tracker = new ZroWeightTracker(address(this), address(d.hook), address(router), address(pm));
        (address coin, PoolId id) = _launch(0);
        ZroRewardVault vault = new ZroRewardVault(
            address(this), address(this), address(d.timelock), address(this), IERC20(_zro()), d.hook, tracker
        );
        vault.setSwapper(address(this));
        uint64 epoch = uint64(vm.getBlockTimestamp() / 1 hours);
        vm.prank(coin);
        tracker.onTransfer(address(0), address(this), 1 ether);
        vm.warp(vm.getBlockTimestamp() + 1 hours);
        vault.fund(id, epoch, 1 ether);
        assertEq(vault.claimable(id, epoch, address(this)), 1 ether);
    }

    function test_mainnetGuardRejectsAShortDelayAndMockZro() public {
        ZroMainnetGuard guard = new ZroMainnetGuard();
        address safe = address(0x5AFE);
        address zro = guard.canonical();
        vm.expectRevert(ZroMainnetGuard.MainnetConfig.selector);
        guard.assertReady(8453, zro, 60, safe, safe, address(this));
        guard.assertReady(8453, zro, 48 hours, safe, safe, address(this));
        guard.assertReady(84532, address(0), 60, address(this), address(this), address(this));
    }

    function _coin() internal returns (ZroWeightTracker tracker, CoinAllow list, address coin) {
        tracker = new ZroWeightTracker(address(this), address(0), address(0), address(0));
        LaunchToken impl = new LaunchToken();
        LaunchToken token = LaunchToken(Clones.clone(address(impl)));
        token.initialize("Coin", "C", address(this), C.SUPPLY, address(0), 0);
        list = new CoinAllow();
        list.allow(address(token));
        coin = address(token);
    }

    function _zro() internal returns (address) {
        return address(new MockHolder());
    }
}

/// @dev Enough of an ERC-20 for the vault to approve and transfer during fund.
contract MockHolder {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor() {
        balanceOf[msg.sender] = 100 ether;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}
