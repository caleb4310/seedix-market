// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Sentinel recheck-2 tests, adapted to the keeper, the burn-pair pot, and the minimum interval.
import {Test} from "forge-std/Test.sol";
import {Fixture} from "../utils/Fixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {SeedixConstants as C} from "../../src/libraries/SeedixConstants.sol";
import {BuybackExecutor} from "../../src/buyback/BuybackExecutor.sol";
import {SeedixRoles} from "../../src/access/SeedixRoles.sol";
import {LaunchHook} from "../../src/hook/LaunchHook.sol";
import {FeeVault} from "../../src/vault/FeeVault.sol";
import {KickbackDistributor} from "../../src/kickback/KickbackDistributor.sol";
import {LiquidityLocker} from "../../src/launch/LiquidityLocker.sol";
import {DeploySeedix} from "../../script/Deploy.s.sol";

contract ReviewRecheck2CapTest is Fixture {
    PoolId internal id;
    address internal coin;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(2);
    }

    function _fund() internal {
        _buy(id, 20 ether);
        vm.warp(vm.getBlockTimestamp() + C.TWAP_WINDOW + 1);
    }

    /// A non-keeper cannot reserve the period cap.
    function test_RC2_anyoneCanExhaustPeriodCap() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(BuybackExecutor.NotKeeper.selector);
        d.executor.buybackCoin(id, 1 ether, 1);
        assertEq(d.executor.spentInPeriod(id), 0);
        vm.warp(vm.getBlockTimestamp() + C.BUYBACK_INTERVAL);
        vm.prank(address(0xBAD));
        vm.expectRevert(BuybackExecutor.NotKeeper.selector);
        d.executor.buybackCoin(id, 1, 1);
    }

    /// The minimum interval blocks another buyback until the window opens.
    function test_RC2_periodEdge() public {
        _fund();
        vm.prank(admin);
        d.executor.setMaxInPerPeriod(1 ether);
        uint256 t0 = vm.getBlockTimestamp();
        d.executor.buybackCoin(id, 1 ether, 1);
        vm.warp(t0 + C.BUYBACK_INTERVAL - 1);
        vm.expectRevert(BuybackExecutor.TooSoon.selector);
        d.executor.buybackCoin(id, 1 ether, 1);
        vm.warp(t0 + C.BUYBACK_INTERVAL);
        d.executor.buybackCoin(id, 1 ether, 1);
        assertEq(d.executor.periodStart(id), t0 + C.BUYBACK_INTERVAL);
    }

    /// A second buyback one second before the interval cannot stack another cap.
    function test_RC2_fixedWindowBurst() public {
        _fund();
        vm.prank(admin);
        d.executor.setMaxInPerPeriod(2 ether);
        uint256 t0 = vm.getBlockTimestamp();
        d.executor.buybackCoin(id, 1 ether, 1);
        vm.warp(t0 + C.BUYBACK_INTERVAL - 1);
        vm.expectRevert(BuybackExecutor.TooSoon.selector);
        d.executor.buybackCoin(id, 1 ether, 1);
        assertEq(d.executor.spentInPeriod(id), 1 ether);
    }

    function test_RC2_capPersistsAndOverCapReverts() public {
        _fund();
        vm.prank(admin);
        d.executor.setMaxInPerPeriod(2 ether);
        d.executor.buybackCoin(id, 2 ether, 1);
        vm.expectRevert(BuybackExecutor.TooSoon.selector);
        d.executor.buybackCoin(id, 1, 1);
        assertEq(d.executor.spentInPeriod(id), 2 ether);
        vm.warp(vm.getBlockTimestamp() + C.BUYBACK_INTERVAL);
        vm.expectRevert(BuybackExecutor.AboveCap.selector);
        d.executor.buybackCoin(id, 2 ether + 1, 1);
        assertEq(d.executor.spentInPeriod(id), 2 ether);
    }
}

contract ReviewRecheck2SweepTest is Fixture {
    PoolId internal id;
    address internal coin;
    address internal plat;
    PoolId internal platId;

    function setUp() public override {
        super.setUp();
        (coin, id) = _launch(0);
        vm.prank(admin);
        (plat, platId) = d.launcher.launchPlatformToken(_params(address(whype), 0, 0, address(0)));
        IERC20(plat).approve(address(router), type(uint256).max);
        vm.warp(vm.getBlockTimestamp() + 20);
        _buy(platId, 10_000 ether);
        _sell(platId, IERC20(plat).balanceOf(address(this)) / 2);
    }

    function _plat(PoolId p) internal view returns (uint128 bp, uint128 bc) {
        (,,, bp, bc) = d.hook.pots(p);
    }

    function test_RC2_overSweepDonationIgnored_doubleSweepNoop() public {
        d.locker.collect(platId);
        Currency W = Currency.wrap(address(whype));
        uint256 owed = d.executor.collected(W);
        assertGt(owed, 0);
        whype.transfer(address(d.executor), 123 ether); // donation / stray funds
        (uint128 bp0,) = _plat(platId);
        vm.prank(address(0xBAD));
        d.executor.sweepCollected();
        (uint128 bp1,) = _plat(platId);
        assertEq(uint256(bp1 - bp0), owed, "only the recorded amount moves");
        assertEq(d.executor.collected(W), 0);
        d.executor.sweepCollected(); // second sweep
        (uint128 bp2,) = _plat(platId);
        assertEq(bp2, bp1, "double sweep is a no-op");
        assertEq(whype.balanceOf(address(d.executor)), 123 ether, "donation stays (stuck, info)");
    }

    function test_RC2_noteCollectedOnlyLocker() public {
        vm.expectRevert(BuybackExecutor.NotLocker.selector);
        d.executor.noteCollected(Currency.wrap(address(whype)), 1e30);
        vm.prank(address(d.locker));
        vm.expectRevert(BuybackExecutor.Nothing.selector);
        d.executor.noteCollected(Currency.wrap(address(whype)), 0);
    }

    /// The locker could over-record if it noted more than it paid. Check notes == executor inflow.
    function test_RC2_noteEqualsInflow() public {
        uint256 b0 = whype.balanceOf(address(d.executor));
        uint256 p0 = IERC20(plat).balanceOf(address(d.executor));
        (uint128 a0, uint128 a1) = d.locker.collect(platId);
        uint256 inW = whype.balanceOf(address(d.executor)) - b0;
        uint256 inP = IERC20(plat).balanceOf(address(d.executor)) - p0;
        assertEq(d.executor.collected(Currency.wrap(address(whype))), inW);
        assertEq(d.executor.collected(Currency.wrap(plat)), inP);
        assertEq(uint256(a0) + uint256(a1), inW + inP);
    }

    /// A non-platform pool's collect never notes anything (fees go to its creator).
    function test_RC2_nonPlatformCollectNotNoted() public {
        IERC20(coin).approve(address(router), type(uint256).max);
        _buy(id, 5_000 ether);
        _sell(id, IERC20(coin).balanceOf(address(this)) / 2);
        uint256 before = d.executor.collected(Currency.wrap(address(whype)));
        d.locker.collect(id);
        assertEq(d.executor.collected(Currency.wrap(address(whype))), before);
    }
}

contract ReviewRecheck2DeployTest is Test {
    uint256 constant PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80; // anvil #0 (public)

    function test_RC2_deployerHoldsNothing() public {
        address deployer = vm.addr(PK);
        address admin = address(0xAD11);
        vm.chainId(31337);
        vm.deal(deployer, 100 ether);
        DeploySeedix s = new DeploySeedix();
        s.deploy(PK, admin, admin);
        (
            ,,
            address tlA,
            address rolesA,
            address vaultA,
            address execA,
            address distA,
            address hookA,
            address launcherA,
            address lockerA
        ) = s.last();
        TimelockController tl = TimelockController(payable(tlA));
        bytes32[4] memory rs = [tl.DEFAULT_ADMIN_ROLE(), tl.PROPOSER_ROLE(), tl.EXECUTOR_ROLE(), tl.CANCELLER_ROLE()];
        for (uint256 i; i < 4; i++) {
            assertFalse(tl.hasRole(rs[i], deployer), "deployer timelock role");
        }
        assertTrue(tl.hasRole(tl.CANCELLER_ROLE(), admin));
        assertFalse(tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), admin), "admin is not timelock admin");
        SeedixRoles r = SeedixRoles(rolesA);
        assertTrue(r.admin() != deployer && r.guardian() != deployer);
        assertTrue(KickbackDistributor(distA).publisher() != deployer);
        // one-shot initializers are spent: deployer cannot rewire anything
        vm.startPrank(deployer);
        vm.expectRevert();
        LaunchHook(hookA).setLauncher(address(1));
        vm.expectRevert();
        LaunchHook(hookA).setLocker(address(1));
        vm.expectRevert();
        FeeVault(vaultA).setHook(LaunchHook(address(1)));
        vm.expectRevert();
        BuybackExecutor(execA).wire(LaunchHook(address(1)), address(1), address(1));
        vm.expectRevert();
        LiquidityLocker(lockerA).wire(LaunchHook(address(1)), address(1), address(1));
        vm.expectRevert();
        KickbackDistributor(distA).wire(LaunchHook(address(1)), address(1), address(1), address(1), address(1));
        vm.stopPrank();
        launcherA;
    }

    function test_RC2_revertsOn99801WithoutCode() public {
        vm.chainId(99801);
        DeploySeedix s = new DeploySeedix();
        vm.expectRevert(); // MissingCode(CREATE2 / WHYPE / USDC / PERMIT2)
        s.deploy(PK, address(0xAD11), address(0xAD11));
    }

    function test_RC2_revertsOn99901WithoutCode() public {
        vm.chainId(99901);
        DeploySeedix s = new DeploySeedix();
        vm.expectRevert(abi.encodeWithSelector(DeploySeedix.ForbiddenChain.selector, uint256(99901)));
        s.deploy(PK, address(0xAD11), address(0xAD11));
    }

    /// Mainnet is not this script, even if canonical code is present.
    function test_RC2_99901AlwaysRevertsOnUsdc() public {
        vm.chainId(99901);
        vm.etch(0xbA876237B0F021A6c6D852d6c26E107997cC5E81, hex"00");
        vm.etch(0x000000000022D473030F116dDEE9F6B43aC78BA3, hex"00");
        DeploySeedix s = new DeploySeedix();
        vm.expectRevert(abi.encodeWithSelector(DeploySeedix.ForbiddenChain.selector, uint256(99901)));
        s.deploy(PK, address(0xAD11), address(0xAD11));
    }

    function test_RC2_otherChainForbidden() public {
        vm.chainId(1);
        DeploySeedix s = new DeploySeedix();
        vm.expectRevert(abi.encodeWithSelector(DeploySeedix.ForbiddenChain.selector, uint256(1)));
        s.deploy(PK, address(0xAD11), address(0xAD11));
    }

    /// 31337: mocks are created (no canonical code on fresh anvil-in-test).
    function test_RC2_mocksOnlyOnLocal() public {
        vm.chainId(31337);
        DeploySeedix s = new DeploySeedix();
        s.deploy(PK, address(0xAD11), address(0xAD11));
    }
}
