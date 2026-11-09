// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {LaunchToken} from "../src/token/LaunchToken.sol";
import {MockXStock} from "../src/token/MockXStock.sol";

contract ClaimsTest is Fixture {
    using CurrencyLibrary for Currency;

    address internal coin;
    PoolId internal id;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(0);
    }

    function _prime() internal {
        _buy(id, 100 ether);
    }

    function test_creatorClaimsPairNotCoinTogether() public {
        _prime();
        (uint128 pairAmt, uint128 coinAmt,,,) = d.hook.pots(id);
        assertGt(pairAmt, 0);
        assertEq(coinAmt, 0);
        uint256 before = whype.balanceOf(creator);
        vm.prank(creator);
        d.vault.claimCreator(id, true);
        assertEq(whype.balanceOf(creator) - before, pairAmt);
        (uint128 left,,,,) = d.hook.pots(id);
        assertEq(left, 0);
        assertEq(
            pm.balanceOf(address(d.hook), Currency.wrap(address(whype)).toId()),
            d.hook.accounted(Currency.wrap(address(whype)))
        );
    }

    function test_strangerCannotClaim() public {
        _prime();
        vm.prank(address(0x1234));
        vm.expectRevert();
        d.vault.claimCreator(id, true);
    }

    function test_noOperator() public view {
        assertFalse(pm.isOperator(address(d.hook), address(d.vault)));
        assertFalse(pm.isOperator(address(d.hook), address(d.executor)));
        assertFalse(pm.isOperator(address(d.hook), address(d.distributor)));
        assertFalse(pm.isOperator(address(d.hook), admin));
    }

    function test_pausedPairDoesNotBlockCoinClaim() public {
        _prime();
        _sellSome();
        whype.pause();
        vm.prank(creator);
        d.vault.claimCreator(id, false);
        vm.prank(creator);
        vm.expectRevert();
        d.vault.claimCreator(id, true);
        whype.unpause();
    }

    function test_burnReducesSupply() public {
        _prime();
        _sellSome();
        (,,,, uint128 burnCoin) = d.hook.pots(id);
        assertGt(burnCoin, 0);
        uint256 supplyBefore = LaunchToken(coin).totalSupply();
        d.executor.burnCoinSide(id);
        assertEq(LaunchToken(coin).totalSupply(), supplyBefore - burnCoin);
        (,,,, uint128 left) = d.hook.pots(id);
        assertEq(left, 0);
    }

    function test_walletPullsToFeeWallet() public {
        _prime();
        uint256 owed = d.hook.platformWallet(Currency.wrap(address(whype)));
        assertGt(owed, 0);
        uint256 before = whype.balanceOf(C_FEE());
        d.vault.claimPlatformWallet(Currency.wrap(address(whype)));
        assertEq(whype.balanceOf(C_FEE()) - before, owed);
    }

    function _sellSome() internal {
        uint256 bal = IERC20(coin).balanceOf(address(this));
        IERC20(coin).approve(address(router), type(uint256).max);
        _sell(id, bal / 2);
    }

    function C_FEE() internal pure returns (address) {
        return 0xf4383D1Ecfb525294A266929c7D4796314a764F9;
    }
}
