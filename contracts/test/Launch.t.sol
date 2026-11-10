// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";
import {LaunchCurve} from "../src/libraries/LaunchCurve.sol";
import {Launcher} from "../src/launch/Launcher.sol";
import {LaunchHook} from "../src/hook/LaunchHook.sol";
import {SeedixRouter} from "../src/router/SeedixRouter.sol";
import {MockXStock} from "../src/token/MockXStock.sol";

contract SameTxBuyer {
    function go(
        Launcher launcher,
        LaunchHook hook,
        SeedixRouter router,
        MockXStock pair,
        Launcher.LaunchParams calldata params
    ) external {
        launcher.launch(params);
        PoolId id = hook.pools(hook.poolCount() - 1);
        (,, bool coinIsToken0,,,,) = hook.config(id);
        pair.approve(address(router), type(uint256).max);
        router.swap(
            hook.keyOf(id),
            !coinIsToken0,
            -1 ether,
            0,
            block.timestamp,
            !coinIsToken0 ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        );
    }
}

contract LaunchTest is Fixture {
    function test_hookFlags() public view {
        assertEq(uint160(address(d.hook)) & ((1 << 14) - 1), C.HOOK_FLAGS);
    }

    function test_launchSpendsNoPairAndLocksConfig() public {
        uint256 pairBefore = whype.balanceOf(address(pm));
        (address coin, PoolId id) = _launch(0);
        assertEq(whype.balanceOf(address(pm)), pairBefore);
        assertEq(IERC20(coin).balanceOf(address(d.launcher)), 0);
        assertEq(LaunchTokenBalance.supply(coin), C.SUPPLY);
        (int24 lower, int24 upper,, uint128 liq) = d.locker.nearPos(id);
        assertGt(liq, 0);
        assertLt(lower, upper);
        (,, bool coinIsToken0,,,,) = d.hook.config(id);
        int24 tick = _spot(id);
        if (coinIsToken0) assertEq(tick, lower);
        else assertEq(tick, upper);
    }

    function test_teamSupplyWithinFivePercent() public {
        address team = address(0xBEEF);
        d.launcher.launch(_params(address(whype), 1, 500, team));
        PoolId id = d.hook.pools(d.hook.poolCount() - 1);
        (address coin,,,,,,) = d.hook.config(id);
        uint256 teamBal = IERC20(coin).balanceOf(team);
        assertEq(teamBal, C.SUPPLY * 5 / 100);
        assertEq(IERC20(coin).totalSupply(), C.SUPPLY);
    }

    function test_rejectsBadRecipients() public {
        Launcher.LaunchParams memory p = _params(address(whype), 0, 0, address(0));
        p.feeRecipient = address(0);
        vm.expectRevert(Launcher.BadRecipient.selector);
        d.launcher.launch(p);
        p.feeRecipient = C.DEAD;
        vm.expectRevert(Launcher.BadRecipient.selector);
        d.launcher.launch(p);
        p.feeRecipient = C.FEE_WALLET;
        vm.expectRevert(Launcher.BadRecipient.selector);
        d.launcher.launch(p);
        p = _params(address(whype), 9, 0, address(0));
        vm.expectRevert(Launcher.BadArgs.selector);
        d.launcher.launch(p);
    }

    function test_noCreatorBuyInLaunchTransaction() public {
        SameTxBuyer buyer = new SameTxBuyer();
        whype.transfer(address(buyer), 10 ether);
        Launcher.LaunchParams memory params = _params(address(whype), 0, 0, address(0));
        (bool ok, bytes memory data) =
            address(buyer).call(abi.encodeCall(SameTxBuyer.go, (d.launcher, d.hook, router, whype, params)));
        assertFalse(ok);
        assertTrue(_contains(data, LaunchHook.SwapDuringLaunch.selector));
    }

    function test_strangerCannotPauseOrLaunchPlatform() public {
        vm.prank(address(0x1234));
        vm.expectRevert(Launcher.NotGuardian.selector);
        d.launcher.pause();
        vm.prank(address(0x1234));
        vm.expectRevert(Launcher.NotAdmin.selector);
        d.launcher.launchPlatformToken(_params(address(whype), 0, 0, address(0)));
    }

    function test_platformTokenOnceAndBurn() public {
        vm.prank(admin);
        (address coin, PoolId id) = d.launcher.launchPlatformToken(_params(address(whype), 0, 0, address(0)));
        (,,, uint8 mode, bool isPlatform,,) = d.hook.config(id);
        assertEq(mode, 2);
        assertTrue(isPlatform);
        assertEq(d.executor.platformToken(), coin);
        assertEq(d.locker.lpRecipientOverride(id), address(d.executor));
        vm.prank(admin);
        vm.expectRevert(Launcher.PlatformAlreadyLaunched.selector);
        d.launcher.launchPlatformToken(_params(address(whype), 0, 0, address(0)));
    }

    function _contains(bytes memory hay, bytes4 needle) internal pure returns (bool) {
        if (hay.length < 4) return false;
        for (uint256 i; i <= hay.length - 4; ++i) {
            if (hay[i] == needle[0] && hay[i + 1] == needle[1] && hay[i + 2] == needle[2] && hay[i + 3] == needle[3]) {
                return true;
            }
        }
        return false;
    }
}

library LaunchTokenBalance {
    function supply(address token) internal view returns (uint256) {
        return IERC20(token).totalSupply();
    }
}

contract OrientationTest is Fixture {
    function test_curvePlansBothSidesOnTheBoundary() public pure {
        LaunchCurve.Plan memory a = LaunchCurve.plan(true, 20_000 ether, C.SUPPLY);
        LaunchCurve.Plan memory b = LaunchCurve.plan(false, 20_000 ether, C.SUPPLY);
        assertEq(a.tick, a.near.lower);
        assertEq(b.tick, b.near.upper);
        assertGt(a.near.liquidity, 0);
        assertGt(b.near.liquidity, 0);
        assertEq(a.sqrtPriceX96, TickMath.getSqrtPriceAtTick(a.tick));
        assertEq(b.sqrtPriceX96, TickMath.getSqrtPriceAtTick(b.tick));
    }

    function test_livePoolMatchesCoinOrdering() public {
        MockXStock low = _pairAt(true);
        _allow(address(low));
        (, PoolId idLow) = d.launcher.launch(_params(address(low), 0, 0, address(0)));
        MockXStock high = _pairAt(false);
        _allow(address(high));
        (, PoolId idHigh) = d.launcher.launch(_params(address(high), 0, 0, address(0)));
        (,, bool low0,,,,) = d.hook.config(idLow);
        (,, bool high0,,,,) = d.hook.config(idHigh);
        assertTrue(low0);
        assertFalse(high0);
        _boundary(idLow, true);
        _boundary(idHigh, false);
    }

    function _pairAt(bool wantCoin0) internal returns (MockXStock pair) {
        bytes memory args = abi.encode("Side", "S", uint8(18), address(this));
        bytes32 initHash = keccak256(abi.encodePacked(type(MockXStock).creationCode, args));
        for (uint256 i = 1; i < 400; ++i) {
            bytes32 salt = bytes32(i ^ (wantCoin0 ? uint256(1) << 255 : 0));
            address predicted = vm.computeCreate2Address(salt, initHash, address(this));
            uint256 nonce = d.launcher.launchNonce();
            bytes32 coinSalt = keccak256(abi.encode(address(this), nonce, "Seed Coin", "SEED", predicted));
            address coin = Clones.predictDeterministicAddress(address(d.implementation), coinSalt, address(d.launcher));
            if (predicted.code.length != 0) continue;
            if ((coin < address(whype)) == wantCoin0) {
                pair = new MockXStock{salt: salt}("Side", "S", 18, address(this));
                assertEq(address(pair), predicted);
                return pair;
            }
        }
        revert("salt");
    }

    function _allow(address pair) internal {
        bytes memory data = abi.encodeCall(Launcher.setPairAllowed, (pair, true));
        TimelockController tl = d.roles.timelock();
        vm.prank(admin);
        tl.schedule(address(d.launcher), 0, data, bytes32(0), keccak256(abi.encode(pair)), 48 hours);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(admin);
        tl.execute(address(d.launcher), 0, data, bytes32(0), keccak256(abi.encode(pair)));
        _openRoute(pair);
    }

    function _boundary(PoolId id, bool coinIsToken0) internal view {
        (int24 lower, int24 upper,,) = d.locker.nearPos(id);
        int24 tick = _spot(id);
        if (coinIsToken0) assertEq(tick, lower);
        else assertEq(tick, upper);
    }
}

contract PauseTest is Fixture {
    PoolId internal id;

    function setUp() public override {
        super.setUp();
        (, id) = _launch(0);
    }

    function test_pauseBlocksNewLaunchesOnly() public {
        vm.prank(admin);
        d.launcher.pause();
        vm.expectRevert(Launcher.Paused.selector);
        _launch(0);
        assertGt(_buy(id, 1 ether), 0);
        vm.prank(address(0x999));
        vm.expectRevert(Launcher.NotTimelock.selector);
        d.launcher.unpause();
    }
}
