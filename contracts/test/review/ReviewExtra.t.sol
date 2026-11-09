// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Sentinel review tests (local only, not for the PR).
import {Fixture} from "../utils/Fixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {SeedixConstants as C} from "../../src/libraries/SeedixConstants.sol";
import {FeeMath} from "../../src/libraries/FeeMath.sol";
import {BuybackExecutor} from "../../src/buyback/BuybackExecutor.sol";
import {TwapGuard} from "../../src/libraries/TwapGuard.sol";

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

contract Initer is IUnlockCallback {
    function unlockCallback(bytes calldata) external pure returns (bytes memory) {
        return "";
    }
}

contract ReviewOracleTest is Fixture {
    PoolId internal id;
    address internal coin;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(0);
        IERC20(coin).approve(address(router), type(uint256).max);
    }

    /// C-01 residual: the 30s gate samples the tick at the END of each interval and consult()
    /// extrapolates with the last stored tick, not slot0. One block of manipulated price right
    /// before a write is credited for the whole interval and then for all idle time after it.
    function test_R_oracleStaleExtrapolationPinsTwap() public {
        // Organic warm-up: some liquidity on the pair side, pool older than the window.
        vm.warp(vm.getBlockTimestamp() + 31 minutes);
        _buy(id, 2_000 ether); // writes honest observation
        int24 honest = _spot(id);
        uint256 t = vm.getBlockTimestamp();

        uint256 pairBefore = whype.balanceOf(address(this));
        uint256 coinBefore = IERC20(coin).balanceOf(address(this));
        // Gate is closed (last write at t). Pump at t+29: no write.
        vm.warp(t + 29);
        _buy(id, 20_000 ether);
        int24 pumped = _spot(id);
        // t+30: any tiny swap (attacker or an arbitrageur) writes the PUMPED pre-swap tick.
        vm.warp(t + 30);
        _buy(id, 1e12);
        // t+31: dump back. Gate closed again, so the honest price is never recorded.
        vm.warp(t + 31);
        uint256 coinsBought = IERC20(coin).balanceOf(address(this)) - coinBefore;
        _sell(id, coinsBought);
        int24 after_ = _spot(id);
        uint256 cost = pairBefore - whype.balanceOf(address(this));

        // 30 idle minutes at the honest price.
        vm.warp(t + 31 + 30 minutes);
        (int24 twap, int24 spot) = d.hook.consult(id, C.TWAP_WINDOW);
        emit log_named_int("honest tick", honest);
        emit log_named_int("pumped tick", pumped);
        emit log_named_int("spot after dump", after_);
        emit log_named_int("twap (30m) after 30m idle", twap);
        emit log_named_int("spot now", spot);
        emit log_named_uint("attacker cost (pair wei)", cost);
        // Price was honest for ~29m59s of the window, yet the TWAP sits at the pumped tick.
        int24 dist = twap > spot ? twap - spot : spot - twap;
        assertLt(dist, C.BAND_TICKS, "v2: twap must NOT be pinned (true time-weighting)");
    }

    /// Coverage: 64 slots at >=30s spacing always span >= 31.5 min, so dense trading cannot
    /// un-cover the window; sparse trading covers it trivially.
    function test_R_coverageHoldsUnderDenseTrading() public {
        vm.warp(vm.getBlockTimestamp() + 10);
        for (uint256 i; i < 200; ++i) {
            vm.warp(vm.getBlockTimestamp() + 30);
            _buy(id, 1 ether);
        }
        d.hook.consult(id, C.TWAP_WINDOW); // must not revert
        assertEq(d.hook.observationCount(id), 64);
    }
}

contract ReviewAccessTest is Fixture {
    PoolId internal id;
    address internal coin;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(0);
        IERC20(coin).approve(address(router), type(uint256).max);
    }

    /// Nobody but the launcher can initialise a pool on our hook.
    function test_R_foreignInitializeReverts() public {
        PoolKey memory key = d.hook.keyOf(id);
        key.fee = 3000; // a different pool on the same hook
        vm.expectRevert();
        pm.initialize(key, TickMath.getSqrtPriceAtTick(0));
    }

    /// Stage cannot be written by anyone but the launcher.
    function test_R_stageOnlyLauncher() public {
        PoolKey memory key = d.hook.keyOf(id);
        vm.expectRevert();
        d.hook.stage(key, coin, Currency.wrap(address(whype)), true, 0, false, address(this));
        vm.expectRevert();
        d.hook.armLaunchGuard(id);
    }

    /// One-shot initializers cannot be re-run, by anyone (including the initializer).
    function test_R_oneShotInitializers() public {
        vm.expectRevert();
        d.hook.setLauncher(address(this));
        vm.expectRevert();
        d.vault.setHook(d.hook);
    }

    /// beforeAddLiquidity is open: a third party can add a position to a launch pool.
    function test_R_thirdPartyCanAddLiquidity() public {
        vm.warp(vm.getBlockTimestamp() + 11);
        _buy(id, 100 ether);
        LpAdder lp = new LpAdder(IPoolManager(address(pm)));
        IERC20(coin).transfer(address(lp), IERC20(coin).balanceOf(address(this)));
        whype.transfer(address(lp), 1_000 ether);
        PoolKey memory key = d.hook.keyOf(id);
        int24 tick = _spot(id);
        int24 base = (tick / 60) * 60;
        vm.expectRevert();
        lp.add(key, base - 600, base + 600, 1e18);
    }

    /// Dust positions on every initialisable tick along the buy path raise buy gas (grief).
    function test_R_tickCrossingGasGrief() public {
        vm.warp(vm.getBlockTimestamp() + 11);
        _buy(id, 50 ether);
        PoolKey memory key = d.hook.keyOf(id);
        (,, bool coinIsToken0,,,,) = d.hook.config(id);
        LpAdder lp = new LpAdder(IPoolManager(address(pm)));
        IERC20(coin).transfer(address(lp), IERC20(coin).balanceOf(address(this)));
        int24 tick = _spot(id);
        int24 base = (tick / 60) * 60;
        // buys move price up if coin is token0, down otherwise; put dust in that direction
        for (int24 i = 2; i < 302; ++i) {
            int24 lo = coinIsToken0 ? base + i * 60 : base - (i + 1) * 60;
            vm.expectRevert();
            lp.add(key, lo, lo + 60, 1e9);
        }
        uint256 g = gasleft();
        _buy(id, 5_000 ether);
        uint256 used = g - gasleft();
        emit log_named_uint("gas for 5k WHYPE buy across 300 dust ticks", used);
    }

    function test_R_tickCrossingGasBaseline() public {
        vm.warp(vm.getBlockTimestamp() + 11);
        _buy(id, 50 ether);
        uint256 g = gasleft();
        _buy(id, 5_000 ether);
        emit log_named_uint("gas for 5k WHYPE buy, no dust", g - gasleft());
    }

    /// Guardian (== admin) cannot move pots or change fee wallet instantly.
    function test_R_guardianCannotMoveFunds() public {
        vm.warp(vm.getBlockTimestamp() + 11);
        _buy(id, 100 ether);
        vm.startPrank(admin);
        vm.expectRevert();
        d.hook.debitCreatorPair(id, 1, admin);
        vm.expectRevert();
        d.hook.debitPlatformWallet(Currency.wrap(address(whype)), 1, admin);
        vm.expectRevert();
        d.hook.debitBurnPair(id, 1, admin);
        vm.expectRevert();
        d.vault.setFeeWallet(admin);
        vm.expectRevert();
        d.roles.setGuardian(admin);
        vm.stopPrank();
    }

    /// queueSetGuardian uses a constant salt: re-queuing the same target after it ran reverts.
    function test_R_queueSetGuardianSaltCollision() public {
        address g = address(0x6A2D);
        vm.prank(admin);
        bytes32 s1 = d.roles.queueSetGuardian(g);
        vm.warp(vm.getBlockTimestamp() + 48 hours);
        TimelockController tl = d.roles.timelock();
        vm.prank(admin);
        tl.execute(address(d.roles), 0, abi.encodeCall(d.roles.setGuardian, (g)), bytes32(0), s1);
        // v2 (L-01 fixed): re-queueing the same target now succeeds with a fresh salt.
        vm.prank(admin);
        bytes32 s2 = d.roles.queueSetGuardian(g);
        assertTrue(s1 != s2);
    }
}

/// Live fee-path fuzz against contracts/docs/fees.md, with random time since launch.
contract ReviewFeeFuzzTest is Fixture {
    PoolId internal id;
    address internal coin;
    uint40 internal t0;
    Currency internal P;
    Currency internal K;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(0);
        IERC20(coin).approve(address(router), type(uint256).max);
        (,,,,, t0,) = d.hook.config(id);
        P = Currency.wrap(address(whype));
        K = Currency.wrap(coin);
    }

    function _prep(uint256 secs) internal returns (uint256 pips) {
        vm.warp(uint256(t0) + 11);
        _buy(id, 3_000 ether); // inventory of coin for sells (after decay)
        vm.warp(uint256(t0) + 11 + (secs % 15));
        // move the clock "back" in decay terms is impossible; instead launch a fresh pool now
        pips = FeeMath.hookFeePips(t0, vm.getBlockTimestamp());
    }

    function _fresh(uint256 secs) internal returns (uint256 pips) {
        // fresh pool launched in this tx can't be swapped; so we reuse setUp's pool and only
        // vary time inside/after the decay using setUp's launch time.
        vm.warp(uint256(t0) + (secs % 15));
        pips = FeeMath.hookFeePips(t0, vm.getBlockTimestamp());
    }

    function testFuzz_R_exactInBuy(uint256 amt, uint256 secs) public {
        uint256 pips = _fresh(secs);
        amt = bound(amt, 1e6, 5_000 ether);
        uint256 a0 = d.hook.accounted(P);
        uint256 b0 = whype.balanceOf(address(this));
        _buy(id, amt);
        uint256 fee = d.hook.accounted(P) - a0;
        assertEq(b0 - whype.balanceOf(address(this)), amt, "trader pays exactly gross");
        assertEq(fee, amt * pips / 1e6 + amt * 10_000 / 1e6, "floor each line on gross");
    }

    function testFuzz_R_exactOutBuy(uint256 out, uint256 secs) public {
        uint256 pips = _fresh(secs);
        out = bound(out, 1e12, 50_000_000 ether);
        uint256 a0 = d.hook.accounted(P);
        uint256 b0 = whype.balanceOf(address(this));
        uint256 c0 = IERC20(coin).balanceOf(address(this));
        _buyExactOut(id, out);
        assertEq(IERC20(coin).balanceOf(address(this)) - c0, out, "exact coin out");
        uint256 paid = b0 - whype.balanceOf(address(this));
        uint256 fee = d.hook.accounted(P) - a0;
        uint256 rate = pips + 10_000;
        // at least the designed rate of the gross, at most 1 wei over
        assertGe(fee * 1e6, rate * paid - (rate * paid % 1e6), "fee >= floor(rate*gross)");
        assertLe(fee, rate * paid / 1e6 + 1, "fee <= rate*gross + 1");
        (uint256 h, uint256 p) = FeeMath.splitGross(paid - fee, pips);
        assertEq(h + p, fee, "matches splitGross(net)");
    }

    function testFuzz_R_exactInSell(uint256 amt, uint256 secs) public {
        _prep(secs);
        uint256 pips = FeeMath.hookFeePips(t0, vm.getBlockTimestamp());
        uint256 bal = IERC20(coin).balanceOf(address(this));
        amt = bound(amt, 1e6, bal / 2);
        uint256 ak = d.hook.accounted(K);
        uint256 ap = d.hook.accounted(P);
        uint256 b0 = whype.balanceOf(address(this));
        _sell(id, amt);
        uint256 coinFee = d.hook.accounted(K) - ak;
        uint256 platFee = d.hook.accounted(P) - ap;
        uint256 got = whype.balanceOf(address(this)) - b0;
        assertEq(coinFee, amt * pips / 1e6);
        assertEq(platFee, (got + platFee) * 10_000 / 1e6, "platform = floor(1% of pool output)");
    }

    function testFuzz_R_exactOutSell(uint256 out, uint256 secs) public {
        _prep(secs);
        uint256 pips = FeeMath.hookFeePips(t0, vm.getBlockTimestamp());
        out = bound(out, 1e9, 50 ether);
        uint256 ak = d.hook.accounted(K);
        uint256 ap = d.hook.accounted(P);
        uint256 b0 = whype.balanceOf(address(this));
        uint256 c0 = IERC20(coin).balanceOf(address(this));
        (,, bool coinIsToken0,,,,) = d.hook.config(id);
        _swap(id, coinIsToken0, int256(out));
        assertEq(whype.balanceOf(address(this)) - b0, out, "trader receives exactly X");
        uint256 platFee = d.hook.accounted(P) - ap;
        uint256 coinFee = d.hook.accounted(K) - ak;
        uint256 coinPaid = c0 - IERC20(coin).balanceOf(address(this));
        assertEq(platFee, (out * 1e6 + 990_000 - 1) / 990_000 - out, "ceil gross-up on platform");
        (, uint256 h) = FeeMath.grossUp(coinPaid - coinFee, pips);
        assertEq(coinFee, h, "hook gross-up on coin net");
        assertGe(coinFee * 1e6 + 1e6, pips * coinPaid, "hook >= rate of gross (1 wei tolerance)");
    }
}

/// QA: under via_ir, `block.timestamp` read after vm.warp in a loop is cached. The existing
/// Oracle.t.sol::test_spamCannotFlushTheWindow pattern therefore never advances time.
contract ReviewQaTimeTest is Fixture {
    PoolId internal id;

    function setUp() public override {
        super.setUp();
        (, id) = _launch(0);
    }

    function test_R_existingSpamTestDoesNotAdvanceTime() public {
        vm.warp(block.timestamp + 31 minutes);
        uint256 c0 = d.hook.observationCount(id);
        for (uint256 i; i < 40; ++i) {
            _buy(id, 1);
            vm.warp(block.timestamp + 1);
        }
        emit log_named_uint("obs written during the 40 'seconds'", d.hook.observationCount(id) - c0);
        emit log_named_uint("vm.getBlockTimestamp() at end", vm.getBlockTimestamp());
    }
}
