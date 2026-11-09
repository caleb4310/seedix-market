// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Sentinel recheck tests for PR #1 fix commit 8f52cdc9 (local only, not for the PR).
import {Test} from "forge-std/Test.sol";
import {Fixture} from "../utils/Fixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {SeedixConstants as C} from "../../src/libraries/SeedixConstants.sol";
import {SeedixRouter} from "../../src/router/SeedixRouter.sol";
import {SeedixRoles} from "../../src/access/SeedixRoles.sol";
import {DeploySeedix} from "../../script/Deploy.s.sol";
import "forge-std/console2.sol";

contract ReviewRecheckOracleTest is Fixture {
    PoolId internal id;
    address internal coin;
    uint256[] internal ts;
    int24[] internal ticks;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(0);
        IERC20(coin).approve(address(router), type(uint256).max);
        vm.warp(vm.getBlockTimestamp() + 31 minutes);
        _buy(id, 2_000 ether);
        _rec();
        vm.warp(vm.getBlockTimestamp() + C.TWAP_WINDOW); // window fully after ts[0]
    }

    function _rec() internal {
        ts.push(vm.getBlockTimestamp());
        ticks.push(_spot(id));
    }

    /// Ground truth: tick in force on [ts[i], ts[i+1]) is ticks[i] (the post-swap tick).
    function _truth(uint256 window) internal view returns (int24) {
        uint256 nowT = vm.getBlockTimestamp();
        uint256 from = nowT - window;
        int256 acc;
        for (uint256 i = 0; i < ts.length; i++) {
            uint256 a = ts[i];
            uint256 b = i + 1 < ts.length ? ts[i + 1] : nowT;
            if (b <= from) continue;
            if (a < from) a = from;
            acc += int256(ticks[i]) * int256(b - a);
        }
        int256 m = acc / int256(window);
        if (acc < 0 && acc % int256(window) != 0) m--;
        return int24(m);
    }

    function _twap() internal view returns (int24 twap, int24 spot) {
        return d.hook.consult(id, C.TWAP_WINDOW);
    }

    function _absd(int24 a, int24 b) internal pure returns (uint256) {
        return a > b ? uint256(int256(a) - int256(b)) : uint256(int256(b) - int256(a));
    }

    function _sellAll() internal {
        _sell(id, IERC20(coin).balanceOf(address(this)) / 2);
    }

    /// Variant 1: the original PoC (pump 1s before the 30s gate, write, dump, idle).
    function test_RC_v1_pumpRightBeforeWrite() public {
        uint256 t = vm.getBlockTimestamp();
        vm.warp(t + 29);
        _buy(id, 20_000 ether);
        _rec();
        int24 pumped = _spot(id);
        vm.warp(t + 30);
        _buy(id, 1e9);
        _rec();
        _sellAll();
        _rec();
        vm.warp(t + 30 + 1800);
        (int24 twap, int24 spot) = _twap();
        int24 truth = _truth(C.TWAP_WINDOW);
        console2.log("pumped", pumped);
        console2.log("spot", spot);
        console2.log("twap", twap);
        console2.log("truth", truth);
        assertLe(_absd(twap, truth), 1, "twap == ground truth");
        assertLt(_absd(twap, spot), uint256(int256(C.BAND_TICKS)), "not pinned");
    }

    /// Variant 2: hold the pumped price across many blocks (with keepers writing obs every 12s).
    function test_RC_v2_multiBlockHold() public {
        uint256 t = vm.getBlockTimestamp();
        vm.warp(t + 1);
        _buy(id, 20_000 ether);
        _rec();
        int24 pumped = _spot(id);
        uint256 hold = 300;
        for (uint256 s = 12; s <= hold; s += 12) {
            vm.warp(t + 1 + s);
            _buy(id, 1e9);
            _rec();
        }
        _sellAll();
        _rec();
        int24 honest = _spot(id);
        vm.warp(vm.getBlockTimestamp() + 1);
        (int24 twap, int24 spot) = _twap();
        int24 truth = _truth(C.TWAP_WINDOW);
        console2.log("pumped", pumped);
        console2.log("honest", honest);
        console2.log("twap", twap);
        console2.log("truth", truth);
        console2.log("spot", spot);
        assertLe(_absd(twap, truth), 1, "twap == ground truth under multi-block hold");
    }

    /// Variant 3: idle pool. After 6h of no swaps the TWAP equals the live tick.
    function test_RC_v3_idlePool() public {
        uint256 t = vm.getBlockTimestamp();
        vm.warp(t + 40);
        _buy(id, 5_000 ether);
        _rec();
        vm.warp(t + 6 hours);
        (int24 twap, int24 spot) = _twap();
        assertEq(twap, spot, "idle: twap == spot");
        assertEq(twap, _truth(C.TWAP_WINDOW));
    }

    /// Variant 4: random schedule, sub-30s gaps allowed. Error bounded by the 30s ring granularity.
    function testFuzz_RC_oracleMatchesGroundTruth(uint256 seed) public {
        uint256 maxJump;
        int24 prev = _spot(id);
        for (uint256 i = 0; i < 40; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            vm.warp(vm.getBlockTimestamp() + 1 + (seed % 200));
            uint256 amt = 1e15 + (seed >> 16) % 3_000 ether;
            if ((seed >> 8) % 2 == 0) {
                _buy(id, amt);
            } else {
                uint256 bal = IERC20(coin).balanceOf(address(this));
                if (bal > 2) _sell(id, bal / 3);
                else _buy(id, amt);
            }
            _rec();
            uint256 j = _absd(_spot(id), prev);
            if (j > maxJump) maxJump = j;
            prev = _spot(id);
        }
        vm.warp(vm.getBlockTimestamp() + (seed % 90));
        (int24 twap,) = _twap();
        int24 truth = _truth(C.TWAP_WINDOW);
        // ring interpolation can misplace at most <30s of one sub-30s tick move: 30/1800 * jump
        uint256 tol = (maxJump * 30) / C.TWAP_WINDOW + 1;
        assertLe(_absd(twap, truth), tol, "twap within ring-granularity bound of ground truth");
    }

    /// Same, with >=30s gaps: must be exact (+/-1 for floor).
    function testFuzz_RC_oracleExactWhenSpaced(uint256 seed) public {
        for (uint256 i = 0; i < 40; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            vm.warp(vm.getBlockTimestamp() + 30 + (seed % 200));
            uint256 amt = 1e15 + (seed >> 16) % 3_000 ether;
            if ((seed >> 8) % 2 == 0) {
                _buy(id, amt);
            } else {
                uint256 bal = IERC20(coin).balanceOf(address(this));
                if (bal > 2) _sell(id, bal / 3);
                else _buy(id, amt);
            }
            _rec();
        }
        vm.warp(vm.getBlockTimestamp() + (seed % 90));
        (int24 twap,) = _twap();
        assertLe(_absd(twap, _truth(C.TWAP_WINDOW)), 1);
    }
}

contract ReviewRecheckMiscTest is Fixture {
    PoolId internal id;
    address internal coin;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(0);
        IERC20(coin).approve(address(router), type(uint256).max);
    }

    function test_RC_routerGuards() public {
        PoolKey memory key = _key(id);
        (,, bool c0,,,,) = d.hook.config(id);
        bool buyDir = !c0;
        uint256 nowT = vm.getBlockTimestamp();
        vm.expectRevert(SeedixRouter.Expired.selector);
        router.swap(key, buyDir, -1 ether, 0, nowT - 1, _lim(buyDir));
        vm.expectRevert(SeedixRouter.PriceLimit.selector);
        router.swap(key, buyDir, -1 ether, 0, nowT, 0);
        vm.expectRevert(SeedixRouter.TooLittleReceived.selector);
        router.swap(key, buyDir, -1 ether, type(uint128).max, nowT, _lim(buyDir));
        vm.expectRevert(SeedixRouter.TooMuchRequested.selector);
        router.swap(key, buyDir, 1 ether, 1, nowT, _lim(buyDir));
    }

    /// Third party (not the payer) cannot pull another user's approval through the router.
    function test_RC_routerPayerIsMsgSender() public {
        address victim = address(0xBEEF);
        whype.transfer(victim, 10 ether);
        vm.prank(victim);
        whype.approve(address(router), type(uint256).max);
        PoolKey memory key = _key(id);
        (,, bool c0,,,,) = d.hook.config(id);
        uint256 before = whype.balanceOf(victim);
        vm.prank(address(0xBAD));
        vm.expectRevert();
        router.swap(key, !c0, -1 ether, 0, vm.getBlockTimestamp(), _lim(!c0));
        assertEq(whype.balanceOf(victim), before);
    }

    function test_RC_lockerCollectStillWorks() public {
        vm.warp(vm.getBlockTimestamp() + 20);
        _buy(id, 5_000 ether);
        _sell(id, IERC20(coin).balanceOf(address(this)) / 2);
        uint256 b0 = whype.balanceOf(creator);
        uint256 c0b = IERC20(coin).balanceOf(creator);
        (uint128 a0, uint128 a1) = d.locker.collect(id);
        assertGt(uint256(a0) + uint256(a1), 0, "fees collected");
        assertGt(whype.balanceOf(creator) + IERC20(coin).balanceOf(creator), b0 + c0b);
    }

    function test_RC_twoLaunchesOneTx() public {
        (address c2, PoolId id2) = d.launcher.launch(_params(address(whype), 1, 0, address(0)));
        (address c3, PoolId id3) = d.launcher.launch(_params(address(whype), 0, 0, address(0)));
        (address k2,,,,,,) = d.hook.config(id2);
        (address k3,,,,,,) = d.hook.config(id3);
        assertEq(k2, c2);
        assertEq(k3, c3);
        assertTrue(PoolId.unwrap(id2) != PoolId.unwrap(id3));
    }

    /// Platform LP fees can only be swept into the platform pool, for the recorded amount.
    function test_RC_sweepCollectedMisroutesPlatformFees() public {
        vm.prank(admin);
        (address plat, PoolId platId) = d.launcher.launchPlatformToken(_params(address(whype), 0, 0, address(0)));
        IERC20(plat).approve(address(router), type(uint256).max);
        vm.warp(vm.getBlockTimestamp() + 20);
        _buy(platId, 10_000 ether);
        _sell(platId, IERC20(plat).balanceOf(address(this)) / 2);
        d.locker.collect(platId);
        uint256 owed = d.executor.collected(Currency.wrap(address(whype)));
        assertGt(owed, 0, "platform WHYPE LP fees recorded on the executor");
        (,,, uint128 burnPairBefore,) = d.hook.pots(id);
        vm.prank(address(0xA77AC));
        d.executor.sweepCollected();
        (,,, uint128 burnPairAfter,) = d.hook.pots(id);
        assertEq(burnPairAfter, burnPairBefore, "a memecoin pool cannot receive the sweep");
        (,,, uint128 platBurnPair,) = d.hook.pots(platId);
        assertEq(uint256(platBurnPair), owed, "exact recorded amount lands in the platform pot");
        assertEq(d.executor.collected(Currency.wrap(address(whype))), 0);
    }
}

contract ReviewRecheckDeployTest is Test {
    /// The deployer used to keep CANCELLER. It is granted to the admin and renounced by the deployer.
    function test_RC_deployerKeepsCancellerAdminHasNone() public {
        uint256 pk = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80; // anvil #0 (public test key)
        address deployer = vm.addr(pk);
        address admin = address(0xAD11);
        vm.chainId(31337);
        vm.deal(deployer, 100 ether);
        DeploySeedix script = new DeploySeedix();
        script.deploy(pk, admin, admin);
        (,, address timelock, address rolesAddr,,,,,,) = script.last();
        TimelockController tl = TimelockController(payable(timelock));
        SeedixRoles roles = SeedixRoles(rolesAddr);
        assertFalse(tl.hasRole(tl.CANCELLER_ROLE(), deployer), "deployer renounces CANCELLER");
        assertTrue(tl.hasRole(tl.CANCELLER_ROLE(), admin), "admin can cancel");

        vm.prank(admin);
        bytes32 salt = roles.queueSetGuardian(address(0x6A2D));
        bytes32 opId = tl.hashOperation(
            rolesAddr, 0, abi.encodeCall(SeedixRoles.setGuardian, (address(0x6A2D))), bytes32(0), salt
        );
        assertTrue(tl.isOperationPending(opId));
        vm.prank(deployer);
        vm.expectRevert();
        tl.cancel(opId);
        vm.prank(admin);
        tl.cancel(opId);
        assertFalse(tl.isOperationPending(opId));
    }
}
