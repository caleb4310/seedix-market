// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {CommonBase} from "forge-std/Base.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {Fixture} from "../utils/Fixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SeedixRouter} from "../../src/router/SeedixRouter.sol";
import {SeedixDeployer} from "../utils/SeedixDeployer.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LaunchToken} from "../../src/token/LaunchToken.sol";
import {MockXStock} from "../../src/token/MockXStock.sol";
import {SeedixConstants as C} from "../../src/libraries/SeedixConstants.sol";

/// All four swap paths, time warps across the decay, claims and coin burns.
contract ReviewHandler is CommonBase, StdUtils {
    SeedixRouter router;
    SeedixDeployer.Deployed d;
    MockXStock pair;
    address coin;
    PoolId id;
    address creator;
    uint256 public burned;
    uint256 public calls;

    constructor(SeedixRouter r, SeedixDeployer.Deployed memory d_, MockXStock p, address c, PoolId i, address cr) {
        router = r;
        d = d_;
        pair = p;
        coin = c;
        id = i;
        creator = cr;
        p.approve(address(r), type(uint256).max);
        IERC20(c).approve(address(r), type(uint256).max);
    }

    function _c0() internal view returns (bool z) {
        (,, z,,,,) = d.hook.config(id);
    }

    function _sw(bool z, int256 a) internal {
        uint160 lim = z ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        router.swap(d.hook.keyOf(id), z, a, a < 0 ? 0 : type(uint128).max, vm.getBlockTimestamp(), lim);
    }

    function buyIn(uint256 a) external {
        a = bound(a, 1e9, 2_000 ether);
        _sw(!_c0(), -int256(a));
        calls++;
    }

    function buyOut(uint256 a) external {
        a = bound(a, 1e9, 5_000_000 ether);
        _sw(!_c0(), int256(a));
        calls++;
    }

    function sellIn(uint256 a) external {
        uint256 b = IERC20(coin).balanceOf(address(this));
        if (b < 1e9) return;
        a = bound(a, 1e6, b / 2);
        _sw(_c0(), -int256(a));
        calls++;
    }

    function sellOut(uint256 a) external {
        a = bound(a, 1e6, 20 ether);
        _sw(_c0(), int256(a));
        calls++;
    }

    function warp(uint256 s) external {
        vm.warp(vm.getBlockTimestamp() + bound(s, 0, 40));
    }

    function claimPair() external {
        (uint128 v,,,,) = d.hook.pots(id);
        if (v == 0) return;
        vm.prank(creator);
        d.vault.claimCreator(id, true);
    }

    function claimCoin() external {
        (, uint128 v,,,) = d.hook.pots(id);
        if (v == 0) return;
        vm.prank(creator);
        d.vault.claimCreator(id, false);
    }

    function claimWallet() external {
        if (d.hook.platformWallet(Currency.wrap(address(pair))) == 0) return;
        d.vault.claimPlatformWallet(Currency.wrap(address(pair)));
    }

    function burnCoin() external {
        (,,,, uint128 v) = d.hook.pots(id);
        if (v == 0) return;
        d.executor.burnCoinSide(id);
        burned += v;
    }
}

contract ReviewInvariantTest is StdInvariant, Fixture {
    ReviewHandler h;
    address coin;
    PoolId id;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(0);
        h = new ReviewHandler(router, d, whype, coin, id, creator);
        whype.transfer(address(h), 400_000_000 ether);
        targetContract(address(h));
    }

    function _eq(Currency c) internal view {
        uint256 bal = pm.balanceOf(address(d.hook), c.toId());
        assertEq(bal, d.hook.accounted(c), "6909 == accounted");
        assertEq(bal, d.hook.sumPots(c), "6909 == sum of pots");
    }

    function invariant_R_solvencyAllPaths() public view {
        _eq(Currency.wrap(address(whype)));
        _eq(Currency.wrap(coin));
    }

    function invariant_R_supplyTracksBurns() public view {
        assertEq(LaunchToken(coin).totalSupply() + h.burned(), C.SUPPLY);
    }

    function invariant_R_noPlatformInCoin() public view {
        assertEq(d.hook.platformBurn(Currency.wrap(coin)), 0);
        assertEq(d.hook.platformWallet(Currency.wrap(coin)), 0);
    }
}
