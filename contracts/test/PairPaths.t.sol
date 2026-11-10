// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {MockXStock} from "../src/token/MockXStock.sol";
import {Launcher} from "../src/launch/Launcher.sol";
import {TwapGuard} from "../src/libraries/TwapGuard.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {KickTree} from "./utils/KickTree.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RouteSeeder} from "../src/launch/RouteSeeder.sol";

contract FeeOnTransfer is MockXStock {
    constructor() MockXStock("Fee", "FEE", 18, msg.sender) {}

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && value > 1) {
            super._update(from, to, value - 1);
            return;
        }
        super._update(from, to, value);
    }
}

contract RebasingToken {
    string public name = "Rebase";
    string public symbol = "RBASE";
    uint8 public decimals = 18;
    uint256 public index = 1 ether;
    mapping(address => uint256) public shares;
    mapping(address => mapping(address => uint256)) public allowance;

    function balanceOf(address account) public view returns (uint256) {
        return shares[account] * index / 1 ether;
    }

    function setIndex(uint256 next) external {
        index = next;
    }

    function mint(address to, uint256 amount) external {
        shares[to] += amount * 1 ether / index;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        uint256 share = amount * 1 ether / index;
        shares[from] -= share;
        shares[to] += share;
    }
}

contract FalseReturn {
    string public name = "False";
    string public symbol = "FALSE";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    address public failTo;

    function setFail(address account) external {
        failTo = account;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (to == failTo) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract RevertingToken {
    string public name = "Revert";
    string public symbol = "REV";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    address public failTo;

    function setFail(address account) external {
        failTo = account;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (to == failTo) revert("no");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @notice Pair registry, pasted-token checks, and the two-hop buyback.
contract PairPathsTest is Fixture {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function test_feeOnTransferPasteReverts() public {
        FeeOnTransfer token = new FeeOnTransfer();
        token.approve(address(d.launcher), type(uint256).max);
        vm.expectRevert(Launcher.FeeOnTransfer.selector);
        d.launcher.launch(_params(address(token), 0, 0, address(0)));
    }

    function test_pastedKickbackRevertsUntilVetted() public {
        MockXStock token = new MockXStock("Paste", "PASTE", 18, address(this));
        _openRoute(address(token));
        token.approve(address(d.launcher), type(uint256).max);
        vm.expectRevert(Launcher.KickbackNeedsVetted.selector);
        d.launcher.launch(_params(address(token), 1, 0, address(0)));
        d.launcher.launch(_params(address(token), 0, 0, address(0)));
        assertEq(d.launcher.statusOf(address(token)), d.launcher.STATUS_UNVETTED());
    }

    function testFuzz_decimalsOutsideRangeRevert(uint8 decimals) public {
        decimals = uint8(bound(decimals, 0, 36));
        vm.assume(decimals < 6 || decimals > 18);
        OddDecimals token = new OddDecimals(decimals);
        token.mint(address(this), 1000 ether);
        token.approve(address(d.launcher), type(uint256).max);
        vm.expectRevert(Launcher.UnsafePair.selector);
        d.launcher.launch(_params(address(token), 0, 0, address(0)));
    }

    function test_sixAndEighteenDecimalPairsLaunch() public {
        _launchDecimal(6);
        _launchDecimal(18);
    }

    function test_launchTokenAndHookRejectedAsPair() public {
        (address coin,) = _launch(0);
        vm.expectRevert(Launcher.UnsafePair.selector);
        d.launcher.launch(_params(coin, 0, 0, address(0)));
        vm.expectRevert(Launcher.UnsafePair.selector);
        d.launcher.launch(_params(address(d.hook), 0, 0, address(0)));
    }

    function test_falseReturnAndRevertCreditClaimable() public {
        _pushPair(address(new FalseReturn()));
        _pushPair(address(new RevertingToken()));
    }

    function test_rebaseSurplusIsSweptAndShortfallStaysOwed() public {
        RebasingToken token = new RebasingToken();
        token.mint(address(d.distributor), 10 ether);
        token.setIndex(2 ether);
        assertEq(token.balanceOf(address(d.distributor)), 20 ether);
        _through(address(d.distributor), abi.encodeCall(d.distributor.recoverSurplus, (address(token), admin)));
        assertEq(token.balanceOf(address(d.distributor)), 0);
        assertEq(d.distributor.liabilities(address(token)), 0);

        (address coin, PoolId id) = _launch(1);
        coin;
        vm.warp(block.timestamp + 2 hours);
        _buy(id, 100 ether);
        vm.prank(publisher);
        d.distributor.fund(id, 1 ether);
        uint256 owed = d.distributor.liabilities(address(whype));
        assertGt(owed, 0);
        whype.mint(address(d.distributor), 5 ether);
        _through(address(d.distributor), abi.encodeCall(d.distributor.recoverSurplus, (address(whype), admin)));
        assertEq(d.distributor.liabilities(address(whype)), owed);
        assertEq(whype.balanceOf(address(d.distributor)), owed);
        token.setIndex(0.5 ether);
        assertLt(token.balanceOf(address(d.distributor)), 1);
    }

    function test_preIpoTimelockLaunchTradeAndTwoHop() public {
        vm.prank(admin);
        (, PoolId platformId) = d.launcher.launchPlatformToken(_params(address(whype), 0, 0, address(0)));
        platformId;

        MockXStock spacex = new MockXStock("TEST Wrapped SpaceX", "wSPACEx", 18, address(this));
        MockXStock openai = new MockXStock("TEST Wrapped OpenAI", "wOPENAIx", 18, address(this));
        _listPreIpo(spacex);
        _listPreIpo(openai);

        _exercise(spacex);
        _exercise(openai);
    }

    function test_twoHopRevertsWhenRouteSpotLeavesTheBand() public {
        vm.prank(admin);
        d.launcher.launchPlatformToken(_params(address(whype), 0, 0, address(0)));
        MockXStock stock = new MockXStock("Stock", "wNVDAx", 18, address(this));
        RouteSeeder seeder = new RouteSeeder();
        whype.mint(address(seeder), 80 ether);
        stock.transfer(address(seeder), 80 ether);
        (PoolKey memory route,) = seeder.seedWide(pm, address(whype), address(stock), 1 ether, 20);
        _vet(address(stock), d.launcher.CATEGORY_STOCK());
        _through(address(d.executor), abi.encodeCall(d.executor.registerExternal, (route)));
        vm.warp(block.timestamp + C.TWAP_WINDOW);
        d.executor.pokeRoute(address(stock));
        stock.approve(address(router), type(uint256).max);
        bool zeroForOne = Currency.unwrap(route.currency0) == address(stock);
        router.swap(route, zeroForOne, -int256(20 ether), 0, block.timestamp, _lim(zeroForOne));
        vm.expectRevert();
        d.executor.quotePlatform(Currency.wrap(address(stock)), 0.01 ether, 1, 1);
    }

    function _launchDecimal(uint8 decimals) internal {
        OddDecimals token = new OddDecimals(decimals);
        token.mint(address(this), 1_000_000 * 10 ** uint256(decimals));
        _openRouteFor(address(token), 1000 * 10 ** uint256(decimals));
        _vet(address(token), d.launcher.CATEGORY_CRYPTO());
        token.approve(address(router), type(uint256).max);
        Launcher.LaunchParams memory params = _params(address(token), 0, 0, address(0));
        params.startMcapInPair = 20_000 * 10 ** uint256(decimals);
        d.launcher.launch(params);
        Launcher.Inspection memory info = d.launcher.inspect(address(token));
        assertEq(info.decimals, decimals);
        assertTrue(info.kickbackAllowed);
    }

    function _pushPair(address token) internal {
        PairLike(token).mint(address(this), 1_000_000 ether);
        _openRoute(token);
        _vet(token, d.launcher.CATEGORY_CRYPTO());
        PairLike(token).approve(address(router), type(uint256).max);
        (address coin, PoolId id) = d.launcher.launch(_params(token, 1, 0, address(0)));
        vm.warp(block.timestamp + 11);
        _buy(id, 5 ether);
        vm.warp(block.timestamp + 2 hours);
        d.executor.pokeRoute(token);
        d.executor.convertAccrued(id);
        uint256 funded = d.distributor.poolCarry(id);
        uint256 pay = funded * 90 / 100;
        address holder = address(0x1111);
        vm.prank(publisher);
        uint64 epoch = d.distributor.fund(id, 0);
        bytes32 leaf = KickTree.leaf(block.chainid, address(d.distributor), coin, token, epoch, holder, pay);
        vm.prank(publisher);
        d.distributor.postRoot(id, epoch, leaf, keccak256("manifest"));
        vm.warp(block.timestamp + C.REVIEW_WINDOW + 1);
        FailControl(token).setFail(holder);
        address[] memory accounts = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes32[][] memory proofs = new bytes32[][](1);
        accounts[0] = holder;
        amounts[0] = pay;
        proofs[0] = new bytes32[](0);
        d.distributor.push(id, epoch, accounts, amounts, proofs);
        assertEq(IERC20(token).balanceOf(holder), 0);
        assertEq(d.distributor.claimable(id, epoch, holder), pay);
    }

    function _listPreIpo(MockXStock token) internal returns (PoolKey memory key) {
        RouteSeeder seeder = new RouteSeeder();
        whype.mint(address(seeder), 40 ether);
        token.transfer(address(seeder), 40 ether);
        uint256 spent;
        (key, spent) = seeder.seed(pm, address(whype), address(token), 10 ether);
        assertGt(spent, 0);
        _vet(address(token), d.launcher.CATEGORY_PREIPO());
        bytes memory data = abi.encodeCall(d.executor.registerExternal, (key));
        _through(address(d.executor), data);
        assertEq(d.launcher.categoryOf(address(token)), d.launcher.CATEGORY_PREIPO());
        assertTrue(d.launcher.pairAllowed(address(token)));
        assertTrue(d.executor.routeOk(Currency.wrap(address(token))));
    }

    function _exercise(MockXStock token) internal {
        token.approve(address(d.launcher), type(uint256).max);
        (, PoolId id) = d.launcher.launch(_params(address(token), 0, 0, address(0)));
        vm.warp(block.timestamp + 11);
        _buy(id, 5 ether);
        assertGt(d.hook.platformBurn(Currency.wrap(address(whype))), 0);
        (uint128 owed,,,,) = d.hook.pots(id);
        assertGt(owed, 0);
        vm.warp(block.timestamp + C.TWAP_WINDOW);
        d.executor.pokeRoute(address(token));
        uint256 beforeBal = token.balanceOf(creator);
        d.executor.convertAccrued(id);
        assertGt(token.balanceOf(creator), beforeBal);
        uint256 budget = d.hook.platformBurn(Currency.wrap(address(whype)));
        uint256 amount = budget > 0.01 ether ? 0.01 ether : budget;
        d.executor.buybackPlatform(Currency.wrap(address(whype)), amount, 1, 1);
        assertLt(d.hook.platformBurn(Currency.wrap(address(whype))), budget);
    }

    function _vet(address token, uint8 category) internal {
        _through(address(d.launcher), abi.encodeCall(d.launcher.setPair, (token, d.launcher.STATUS_VETTED(), category)));
    }

    function _through(address target, bytes memory data) internal {
        TimelockController tl = d.roles.timelock();
        bytes32 salt = keccak256(data);
        vm.prank(admin);
        tl.schedule(target, 0, data, bytes32(0), salt, 48 hours);
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(admin);
        tl.execute(target, 0, data, bytes32(0), salt);
    }

    function _routeTick(PoolKey memory key) internal view returns (int24 tick) {
        (, tick,,) = IPoolManager(address(pm)).getSlot0(key.toId());
    }
}

interface FailControl {
    function setFail(address) external;
}

interface PairLike {
    function mint(address, uint256) external;
    function approve(address, uint256) external returns (bool);
}

contract OddDecimals is MockXStock {
    constructor(uint8 decimals_) MockXStock("Odd", "ODD", decimals_, msg.sender) {}
}
