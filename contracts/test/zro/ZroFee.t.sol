// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Fixture} from "../utils/Fixture.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LaunchHook} from "../../src/hook/LaunchHook.sol";
import {Launcher} from "../../src/launch/Launcher.sol";
import {ZroFeeMath} from "../../src/zro/ZroFeeMath.sol";
import {ZroRoundSplit} from "../../src/zro/ZroRoundSplit.sol";

contract ZroFeeMathTest {
    function test_defaultIsOnTop() public pure {
        assertEq(uint256(ZroFeeMath.ON_TOP), 1);
        assertEq(uint256(ZroFeeMath.DEFAULT_PROTOCOL_FEE_BPS), 100);
        assertEq(uint256(ZroFeeMath.effective(500, 100, ZroFeeMath.ON_TOP)), 600);
        assertEq(uint256(ZroFeeMath.effective(500, 100, ZroFeeMath.FROM_CREATOR_TAX)), 500);
    }

    function test_onTopAddsProtocolFee() public pure {
        (uint256 holder, uint256 protocol) = ZroFeeMath.splitExactIn(100 ether, 500, 100, ZroFeeMath.ON_TOP);
        assertEq(holder, 5 ether);
        assertEq(protocol, 1 ether);
    }

    function test_fromCreatorTaxTakesTheFeeOutOfTheTax() public pure {
        (uint256 holder, uint256 protocol) = ZroFeeMath.splitExactIn(100 ether, 500, 100, ZroFeeMath.FROM_CREATOR_TAX);
        assertEq(holder, 4 ether);
        assertEq(protocol, 1 ether);
        assertEq(holder + protocol, 5 ether);
    }

    function testFuzz_bothModesStayInsideTheCap(uint128 base, uint16 creator, uint16 protocol) public pure {
        creator = uint16(bound(uint256(creator), 0, ZroFeeMath.MAX_CREATOR_TAX_BPS));
        protocol = uint16(bound(uint256(protocol), 0, ZroFeeMath.MAX_PROTOCOL_FEE_BPS));
        base = uint128(bound(uint256(base), 0, 1_000_000 ether));

        uint16 onTop = ZroFeeMath.effective(creator, protocol, ZroFeeMath.ON_TOP);
        uint16 fromTax = ZroFeeMath.effective(creator, protocol, ZroFeeMath.FROM_CREATOR_TAX);
        assertLe(onTop, ZroFeeMath.MAX_EFFECTIVE_TAX_BPS);
        assertLe(fromTax, ZroFeeMath.MAX_EFFECTIVE_TAX_BPS);
        assertEq(onTop, uint16(uint256(creator) + protocol));
        assertEq(fromTax, creator);

        (uint256 holder, uint256 protocolAmt) = ZroFeeMath.splitExactIn(base, creator, protocol, ZroFeeMath.ON_TOP);
        assertEq(holder + protocolAmt, base * creator / 10_000 + base * protocol / 10_000);

        (uint256 holderFrom, uint256 protocolFrom) =
            ZroFeeMath.splitExactIn(base, creator, protocol, ZroFeeMath.FROM_CREATOR_TAX);
        uint256 tax = base * creator / 10_000;
        assertEq(holderFrom + protocolFrom, tax);
        assertLe(protocolFrom, tax);
    }

    function testFuzz_exactOutPartsSumToTheFee(uint128 net, uint16 creator, uint16 protocol) public pure {
        creator = uint16(bound(uint256(creator), 0, ZroFeeMath.MAX_CREATOR_TAX_BPS));
        protocol = uint16(bound(uint256(protocol), 1, ZroFeeMath.MAX_PROTOCOL_FEE_BPS));
        net = uint128(bound(uint256(net), 1, 1_000_000 ether));
        (uint256 holder, uint256 protocolAmt) = ZroFeeMath.splitExactOut(net, creator, protocol, ZroFeeMath.ON_TOP);
        uint256 eff = uint256(creator) + protocol;
        uint256 gross = mulDivUp(net, 10_000, 10_000 - eff);
        assertEq(holder + protocolAmt, gross - net);
        (uint256 holderFrom, uint256 protocolFrom) =
            ZroFeeMath.splitExactOut(net, creator, protocol, ZroFeeMath.FROM_CREATOR_TAX);
        if (creator == 0) {
            assertEq(holderFrom + protocolFrom, 0);
        } else {
            uint256 grossFrom = mulDivUp(net, 10_000, 10_000 - creator);
            assertEq(holderFrom + protocolFrom, grossFrom - net);
        }
    }

    function mulDivUp(uint256 a, uint256 b, uint256 d) internal pure returns (uint256) {
        return (a * b + d - 1) / d;
    }

    function assertEq(uint256 a, uint256 b) internal pure {
        require(a == b, "eq");
    }

    function assertLe(uint256 a, uint256 b) internal pure {
        require(a <= b, "le");
    }

    function bound(uint256 x, uint256 min, uint256 max) internal pure returns (uint256) {
        return min + (x % (max - min + 1));
    }
}

contract ZroFeeHookTest is Fixture {
    function test_hookDefaultIsOnTopAndChargesBothLines() public {
        assertEq(d.hook.zroFeeMode(), ZroFeeMath.ON_TOP);
        assertEq(d.hook.protocolFeeBps(), 100);
        deployer.setZroAdmin(d.hook, admin, address(d.timelock));
        vm.warp(2 days);
        (, PoolId id) = d.launcher.launchWithZroTax(_params(address(whype), 0, 0, address(0)), 500);
        (bool enabled,, uint16 protocolBps, uint8 mode, uint16 effectiveBps) = d.hook.zroTax(id);
        assertTrue(enabled);
        assertEq(protocolBps, 100);
        assertEq(mode, ZroFeeMath.ON_TOP);
        assertEq(effectiveBps, 600);
        _buy(id, 100 ether);
        assertEq(d.hook.zroHolderPot(id), 5 ether);
        assertEq(d.hook.zroProtocolPot(id), 1 ether);
        Currency pair = Currency.wrap(address(whype));
        assertEq(d.hook.accounted(pair), d.hook.sumPots(pair));
    }

    function test_fromCreatorTaxOnTheHook() public {
        deployer.setZroAdmin(d.hook, admin, address(d.timelock));
        vm.prank(admin);
        d.hook.setZroFeeMode(ZroFeeMath.FROM_CREATOR_TAX);
        vm.warp(2 days);
        (, PoolId id) = d.launcher.launchWithZroTax(_params(address(whype), 0, 0, address(0)), 500);
        (,,, uint8 mode, uint16 effectiveBps) = d.hook.zroTax(id);
        assertEq(mode, ZroFeeMath.FROM_CREATOR_TAX);
        assertEq(effectiveBps, 500);
        _buy(id, 100 ether);
        assertEq(d.hook.zroHolderPot(id), 4 ether);
        assertEq(d.hook.zroProtocolPot(id), 1 ether);
    }

    function test_boundsAndAuth() public {
        deployer.setZroAdmin(d.hook, admin, address(d.timelock));
        vm.warp(2 days);
        (, PoolId id) = _launch(0);
        vm.expectRevert(bytes4(keccak256("TaxBound()")));
        d.launcher.launchWithZroTax(_params(address(whype), 0, 0, address(0)), 901);
        vm.prank(creator);
        d.hook.setCreatorTax(id, 900);
        (, uint16 creatorBps,,, uint16 effectiveBps) = d.hook.zroTax(id);
        assertEq(creatorBps, 900);
        assertEq(effectiveBps, 1000);
        vm.expectRevert(bytes4(keccak256("NotZroAdmin()")));
        d.hook.setZroFeeMode(ZroFeeMath.FROM_CREATOR_TAX);
        vm.prank(address(d.timelock));
        d.hook.setZroFeeMode(ZroFeeMath.FROM_CREATOR_TAX);
        vm.prank(admin);
        vm.expectRevert(bytes4(keccak256("TaxBound()")));
        d.hook.setProtocolFeeBps(101);
        vm.prank(admin);
        d.hook.setProtocolFeeBps(100);
    }

    function test_zeroCreatorTaxCannotOptIn() public {
        deployer.setZroAdmin(d.hook, admin, address(d.timelock));
        vm.warp(2 days);
        vm.expectRevert(Launcher.CreatorTaxZero.selector);
        d.launcher.launchWithZroTax(_params(address(whype), 0, 0, address(0)), 0);
        (, PoolId id) = _launch(0);
        vm.expectRevert(LaunchHook.CreatorTaxZero.selector);
        vm.prank(creator);
        d.hook.setCreatorTax(id, 0);
        vm.expectRevert(LaunchHook.CreatorTaxZero.selector);
        vm.prank(admin);
        d.hook.setCreatorTax(id, 0);
        vm.expectRevert(LaunchHook.CreatorTaxZero.selector);
        vm.prank(address(d.timelock));
        d.hook.setCreatorTax(id, 0);
        vm.expectRevert(LaunchHook.CreatorTaxZero.selector);
        vm.prank(address(d.launcher));
        d.hook.setCreatorTaxFromLauncher(id, 0);
        assertFalse(d.hook.zroTaxSet(id));
    }

    function test_unsetPoolChargesNothingExtra() public {
        (, PoolId id) = _launch(0);
        _buy(id, 100 ether);
        assertEq(d.hook.zroHolderPot(id), 0);
        assertEq(d.hook.zroProtocolPot(id), 0);
        Currency pair = Currency.wrap(address(whype));
        assertEq(d.hook.accounted(pair), d.hook.sumPots(pair));
    }
}

contract ZroSplitTest is Test {
    function testFuzz_sharesSumToTheTotal(uint128 total, uint8 count, uint256 salt) public pure {
        uint256 n = bound(uint256(count), 1, 8);
        uint256[] memory weights = new uint256[](n);
        bool any;
        for (uint256 i; i < n; ++i) {
            salt = uint256(keccak256(abi.encode(salt, i)));
            weights[i] = salt % 50;
            if (weights[i] > 0) any = true;
        }
        uint256[] memory parts = ZroRoundSplit.shares(total, weights);
        uint256 sum;
        for (uint256 i; i < n; ++i) {
            if (weights[i] == 0) assertEq(parts[i], 0);
            sum += parts[i];
        }
        assertEq(sum, any ? uint256(total) : 0);
    }
}
