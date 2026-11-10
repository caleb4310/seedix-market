// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {KickTree} from "./utils/KickTree.sol";
import {MockXStock} from "../src/token/MockXStock.sol";
import {LaunchToken} from "../src/token/LaunchToken.sol";
import {Launcher} from "../src/launch/Launcher.sol";
import {FeeMath} from "../src/libraries/FeeMath.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice The pool is coin/WHYPE. The selected token is backing. Fees convert only inside the band.
contract BackingModesTest is Fixture {
    function test_unvettedBackingCannotKickback() public {
        MockXStock stock = _stock("Unvetted");
        _openRoute(address(stock));
        stock.approve(address(d.launcher), type(uint256).max);
        vm.expectRevert(Launcher.KickbackNeedsVetted.selector);
        d.launcher.launch(_params(address(stock), 1, 0, address(0)));
    }

    function test_keepPaysTheCreatorTheBackingToken() public {
        (PoolId id, MockXStock stock) = _keep();
        assertEq(d.hook.backingOf(id), address(stock));
        (, Currency pair,,,,,) = d.hook.config(id);
        assertEq(Currency.unwrap(pair), address(whype));
        vm.warp(block.timestamp + 11);
        _buy(id, 20 ether);
        vm.warp(block.timestamp + 2 hours);
        d.executor.pokeRoute(address(stock));
        uint256 beforeBal = stock.balanceOf(creator);
        uint256 pot = _creator(id);
        uint256 execBefore = whype.balanceOf(address(d.executor));
        d.executor.convertAccrued(id);
        assertGt(stock.balanceOf(creator), beforeBal);
        assertLt(_creator(id), pot);
        assertEq(whype.balanceOf(address(d.executor)), execBefore);
    }

    function test_kickbackDistributesTheBackingToken() public {
        (PoolId id, MockXStock stock, address coin) = _mode(1);
        vm.warp(block.timestamp + 11);
        _buy(id, 20 ether);
        vm.warp(block.timestamp + 2 hours);
        d.executor.pokeRoute(address(stock));
        d.executor.convertAccrued(id);
        uint256 funded = d.distributor.poolCarry(id);
        assertGt(funded, 0);
        assertEq(stock.balanceOf(address(d.distributor)), funded);
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, 0);
        uint256 pay = funded * 90 / 100;
        address holder = address(0x1111);
        bytes32 root = KickTree.leaf(block.chainid, address(d.distributor), coin, address(stock), epoch, holder, pay);
        vm.prank(publisher);
        d.distributor.postRoot(id, epoch, root, keccak256("manifest"));
        vm.warp(block.timestamp + C.REVIEW_WINDOW + 1);
        address[] memory accounts = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes32[][] memory proofs = new bytes32[][](1);
        accounts[0] = holder;
        amounts[0] = pay;
        proofs[0] = new bytes32[](0);
        d.distributor.push(id, epoch, accounts, amounts, proofs);
        assertEq(stock.balanceOf(holder), pay);
    }

    function test_burnBuysBackAndBurnsTheCoin() public {
        (, PoolId id) = d.launcher.launch(_params(address(0), 2, 0, address(0)));
        assertEq(d.hook.backingOf(id), address(0));
        vm.warp(block.timestamp + 11);
        _buy(id, 100 ether);
        (,,, uint128 burnPair,) = d.hook.pots(id);
        assertGt(burnPair, 0);
        vm.warp(block.timestamp + C.TWAP_WINDOW);
        (address coin,,,,,,) = d.hook.config(id);
        uint256 supply = LaunchToken(coin).totalSupply();
        d.executor.buybackCoin(id, burnPair > 0.1 ether ? 0.1 ether : burnPair, 1);
        assertLt(LaunchToken(coin).totalSupply(), supply);
        vm.expectRevert();
        d.executor.convertAccrued(id);
    }

    function test_platformSplitAndEarlyBurnStayTheSame() public {
        (, PoolId id) = _launch(0);
        uint256 gross = 100 ether;
        _buy(id, gross);
        (uint256 hookAmt, uint256 plat) = FeeMath.exactInBuy(gross, 800_000);
        (uint256 baseAmt, uint256 excess) = FeeMath.splitBaseExcess(hookAmt, 800_000);
        (uint256 burn, uint256 wallet) = FeeMath.splitPlatform(plat, false);
        (uint128 creatorPair,,, uint128 burnPair,) = d.hook.pots(id);
        assertEq(creatorPair, baseAmt);
        assertEq(burnPair, excess);
        assertEq(excess, 79 ether);
        Currency whypeCur = Currency.wrap(address(whype));
        assertEq(d.hook.platformBurn(whypeCur), burn);
        assertEq(d.hook.platformWallet(whypeCur), wallet);
        assertEq(burn + wallet, plat);
    }

    function test_outOfBandConversionLeavesThePot() public {
        (PoolId id, MockXStock stock) = _keep();
        vm.warp(block.timestamp + 11);
        _buy(id, 20 ether);
        vm.warp(block.timestamp + 2 hours);
        _dumpRoute(stock);
        uint256 pot = _creator(id);
        uint256 execBefore = whype.balanceOf(address(d.executor));
        vm.expectRevert();
        d.executor.convertAccrued(id);
        assertEq(_creator(id), pot);
        assertEq(whype.balanceOf(address(d.executor)), execBefore);
    }

    function test_quarterDepthCapAndRetryDoNotStrandWhype() public {
        (PoolId id, MockXStock stock) = _keep();
        vm.warp(block.timestamp + 11);
        _buy(id, 80 ether);
        vm.warp(block.timestamp + 2 hours);
        d.executor.pokeRoute(address(stock));
        uint256 depth = d.executor.routeDepth(Currency.wrap(address(stock)));
        uint256 before = _creator(id);
        assertGt(before, depth / 4);
        d.executor.convertAccrued(id);
        uint256 spent = before - _creator(id);
        assertLe(spent, depth / 4);
        assertGt(spent, 0);
        assertEq(whype.balanceOf(address(d.executor)), 0);
        uint256 mid = _creator(id);
        d.executor.convertAccrued(id);
        assertLt(_creator(id), mid);
        assertEq(whype.balanceOf(address(d.executor)), 0);
    }

    /// forge-config: default.fuzz.runs = 8
    function testFuzz_failedOrPartialConvertDoesNotLeaveWhype(uint96 buyAmt) public {
        buyAmt = uint96(bound(uint256(buyAmt), 2 ether, 40 ether));
        (PoolId id, MockXStock stock) = _keep();
        vm.warp(block.timestamp + 11);
        _buy(id, buyAmt);
        vm.warp(block.timestamp + 2 hours);
        d.executor.pokeRoute(address(stock));
        uint256 pot = _creator(id);
        uint256 held = whype.balanceOf(address(d.executor));
        try d.executor.convertAccrued(id) {
            assertEq(whype.balanceOf(address(d.executor)), held);
            assertLt(_creator(id), pot);
        } catch {
            assertEq(_creator(id), pot);
            assertEq(whype.balanceOf(address(d.executor)), held);
        }
    }

    function _keep() internal returns (PoolId id, MockXStock stock) {
        (id, stock,) = _mode(0);
    }

    function _mode(uint8 mode) internal returns (PoolId id, MockXStock stock, address coin) {
        stock = _stock(mode == 1 ? "Kick" : "Keep");
        _openRoute(address(stock));
        _vet(address(stock));
        (coin, id) = d.launcher.launch(_params(address(stock), mode, 0, address(0)));
    }

    function _stock(string memory name) internal returns (MockXStock) {
        return new MockXStock(name, "STK", 18, address(this));
    }

    function _vet(address token) internal {
        bytes memory data = abi.encodeCall(Launcher.setPair, (token, 1, 1));
        TimelockController tl = d.roles.timelock();
        vm.prank(admin);
        tl.schedule(address(d.launcher), 0, data, bytes32(0), keccak256(data), 48 hours);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(admin);
        tl.execute(address(d.launcher), 0, data, bytes32(0), keccak256(data));
    }

    function _creator(PoolId id) internal view returns (uint256) {
        (uint128 creatorPair,,,,) = d.hook.pots(id);
        return creatorPair;
    }

    function _dumpRoute(MockXStock stock) internal {
        d.executor.pokeRoute(address(stock));
        address token0 = address(stock) < address(whype) ? address(stock) : address(whype);
        address token1 = token0 == address(stock) ? address(whype) : address(stock);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(token0),
            currency1: Currency.wrap(token1),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        bool zeroForOne = token0 == address(stock);
        stock.approve(address(router), type(uint256).max);
        router.swap(key, zeroForOne, -int256(2 ether), 0, block.timestamp, _lim(zeroForOne));
    }
}
