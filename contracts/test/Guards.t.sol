// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Fixture} from "./utils/Fixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";
import {TwapGuard} from "../src/libraries/TwapGuard.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {CustomRevert} from "@uniswap/v4-core/src/libraries/CustomRevert.sol";
import {LaunchHook} from "../src/hook/LaunchHook.sol";
import {BuybackExecutor} from "../src/buyback/BuybackExecutor.sol";

contract LpAdder is IUnlockCallback {
    IPoolManager public pm;

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    function add(PoolKey calldata key, int24 lower, int24 upper, uint128 liq) external {
        pm.unlock(abi.encode(key, lower, upper, liq));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        (PoolKey memory key, int24 lower, int24 upper, uint128 liq) = abi.decode(data, (PoolKey, int24, int24, uint128));
        (BalanceDelta d,) = pm.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: int256(uint256(liq)), salt: 0}),
            ""
        );
        _pay(key.currency0, d.amount0());
        _pay(key.currency1, d.amount1());
        return "";
    }

    function _pay(Currency c, int128 amt) internal {
        if (amt < 0) {
            pm.sync(c);
            IERC20(Currency.unwrap(c)).transfer(address(pm), uint256(uint128(-amt)));
            pm.settle();
        }
    }
}

contract GuardTest is Fixture {
    PoolId internal id;
    address internal coin;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(0);
        IERC20(coin).approve(address(router), type(uint256).max);
    }

    function test_thirdPartyDustPositionReverts() public {
        vm.warp(vm.getBlockTimestamp() + 11);
        _buy(id, 100 ether);
        LpAdder lp = new LpAdder(IPoolManager(address(pm)));
        IERC20(coin).transfer(address(lp), IERC20(coin).balanceOf(address(this)));
        whype.transfer(address(lp), 1_000 ether);
        PoolKey memory key = d.hook.keyOf(id);
        int24 tick = _spot(id);
        int24 base = (tick / 60) * 60;
        vm.expectRevert(
            abi.encodeWithSelector(
                CustomRevert.WrappedError.selector,
                address(d.hook),
                IHooks.beforeAddLiquidity.selector,
                abi.encodePacked(LaunchHook.NotLocker.selector),
                abi.encodePacked(Hooks.HookCallFailed.selector)
            )
        );
        lp.add(key, base - 600, base + 600, 1e18);
    }

    function test_feeCollectionStillRemovesLiquidity() public {
        vm.warp(vm.getBlockTimestamp() + 11);
        _buy(id, 50 ether);
        d.locker.collect(id);
    }

    function test_stockLegFloorUsesCurrencyOrderAndWhypeInput() public {
        vm.prank(admin);
        (, PoolId platformId) = d.launcher.launchPlatformToken(_params(address(whype), 0, 0, address(0)));

        bytes memory data = abi.encodeCall(d.executor.registerRoute, (Currency.wrap(coin), id));
        TimelockController tl = d.roles.timelock();
        vm.prank(admin);
        tl.schedule(address(d.executor), 0, data, bytes32(0), keccak256("route"), 48 hours);
        vm.warp(vm.getBlockTimestamp() + 48 hours + 1);
        vm.prank(admin);
        tl.execute(address(d.executor), 0, data, bytes32(0), keccak256("route"));

        uint256 amountIn = 1 ether;
        (uint256 whypeFloor, uint256 platformFloor) = d.executor.quotePlatform(Currency.wrap(coin), amountIn, 1, 1);

        (,, bool coinIsToken0,,,,) = d.hook.config(id);
        (int24 routeTwap,) = d.hook.consult(id, C.TWAP_WINDOW);
        bool stockInIs0 = coinIsToken0;
        uint256 expectedWhype = TwapGuard.effectiveMin(TwapGuard.minOut(amountIn, routeTwap, stockInIs0), 1);
        uint256 flipped = TwapGuard.effectiveMin(TwapGuard.minOut(amountIn, routeTwap, !stockInIs0), 1);
        assertEq(whypeFloor, expectedWhype);
        assertTrue(whypeFloor != flipped);

        (,, bool platCoin0,,,,) = d.hook.config(platformId);
        (int24 platTwap,) = d.hook.consult(platformId, C.TWAP_WINDOW);
        bool whypeIs0 = !platCoin0;
        uint256 expectedPlatform = TwapGuard.effectiveMin(TwapGuard.minOut(whypeFloor, platTwap, whypeIs0), 1);
        uint256 wrongLeg = TwapGuard.effectiveMin(TwapGuard.minOut(amountIn, platTwap, whypeIs0), 1);
        assertEq(platformFloor, expectedPlatform);
        if (whypeFloor != amountIn) assertTrue(platformFloor != wrongLeg);

        vm.expectRevert(BuybackExecutor.AboveCap.selector);
        d.executor.quotePlatform(Currency.wrap(coin), 50_000 ether + 1, 1, 1);
    }
}
