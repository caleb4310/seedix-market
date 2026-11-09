// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Fixture} from "../utils/Fixture.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {LaunchToken} from "../../src/token/LaunchToken.sol";
import {SeedixConstants as C} from "../../src/libraries/SeedixConstants.sol";
import {FeeHandler} from "./handlers/FeeHandler.sol";

contract FeeInvariantTest is StdInvariant, Fixture {
    using CurrencyLibrary for Currency;

    FeeHandler internal handler;
    address internal coin;
    PoolId internal id;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(0);
        handler = new FeeHandler(router, d.hook, whype, coin, id);
        whype.transfer(address(handler), 500_000 ether);
        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](2);
        sels[0] = handler.buyExactIn.selector;
        sels[1] = handler.sellExactIn.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    function invariant_solvency() public view {
        _eq(Currency.wrap(address(whype)));
        _eq(Currency.wrap(coin));
    }

    function invariant_platformFeeNotInCoin() public view {
        assertEq(d.hook.platformBurn(Currency.wrap(coin)), 0);
        assertEq(d.hook.platformWallet(Currency.wrap(coin)), 0);
    }

    function invariant_supply() public view {
        assertEq(LaunchToken(coin).totalSupply(), C.SUPPLY);
    }

    function invariant_noOperator() public view {
        assertFalse(pm.isOperator(address(d.hook), address(d.vault)));
        assertFalse(pm.isOperator(address(d.hook), address(handler)));
    }

    function _eq(Currency c) internal view {
        uint256 bal = pm.balanceOf(address(d.hook), c.toId());
        assertEq(bal, d.hook.accounted(c));
        assertEq(bal, d.hook.sumPots(c));
    }
}
