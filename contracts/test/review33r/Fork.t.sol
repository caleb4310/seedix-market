// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {SeedixConstants as C} from "../../src/libraries/SeedixConstants.sol";
import {LaunchToken} from "../../src/token/LaunchToken.sol";
import {ZroGraduation} from "../../src/zro/ZroGraduation.sol";
import {ZroWeightTracker} from "../../src/zro/ZroWeightTracker.sol";
import {TestLzEndpoint} from "../zro/TestLzEndpoint.sol";

interface ILiveExcluded {
    function excluded(address account) external view returns (bool);
    function setExcluded(address account, bool isExcluded) external;
}

/// @notice A launcher bytecode that predates `isLaunchedCoin`.
contract LegacyLauncher {}

/// @notice Local fork simulation, plus the allowlist path that does not need a fork.
///         The fork half runs only with BASE_SEPOLIA_FORK=true.
contract RecheckFork is Test {
    address constant ENDPOINT = 0x6EDCE65403992e310A62460808c4b910D972f10f;
    address constant TRACKER = 0x18CAd4686D7864C379cC9A49B926F0c112D3dE1F;
    address constant LAUNCHER = 0xb0F9D152e76D5232A13672EA531aD7BB223e81FB;
    address constant SAFE = 0x246af8d1F7c17790966De3F341e89aacba5e7c03;
    address constant TL = 0xFE7ceDdf8936eA1b8911a13fd7A1385C501616E7;
    address constant COIN = 0x2f4028060D49Cad8302bc81C8Fa84286b4b56958;

    function test_R_M02_allowlistGraduatesWithoutIsLaunchedCoin() public {
        LegacyLauncher legacy = new LegacyLauncher();
        TestLzEndpoint endpoint = new TestLzEndpoint(1, 0.01 ether);
        LaunchToken coin = LaunchToken(Clones.clone(address(new LaunchToken())));
        coin.initialize("C", "C", address(this), C.SUPPLY, address(0), 0);
        address safe = address(0x5AFE);
        ZroGraduation g = new ZroGraduation(address(endpoint), safe, address(0x71), address(0), address(legacy));
        vm.prank(safe);
        vm.expectRevert(ZroGraduation.NotSeedixCoin.selector);
        g.graduate(address(coin));
        vm.prank(safe);
        g.allowCoin(address(coin), true);
        vm.prank(safe);
        address adapter = g.graduate(address(coin));
        assertEq(g.adapterOf(address(coin)), adapter);
    }

    function test_R_M02_liveStack() public {
        if (!vm.envOr("BASE_SEPOLIA_FORK", false)) return;
        vm.createSelectFork("https://sepolia.base.org");
        ZroGraduation blocked = new ZroGraduation(ENDPOINT, SAFE, TL, TRACKER, LAUNCHER);
        vm.prank(SAFE);
        vm.expectRevert();
        blocked.graduate(COIN);

        ZroGraduation g = new ZroGraduation(ENDPOINT, SAFE, TL, address(0), LAUNCHER);
        vm.prank(SAFE);
        vm.expectRevert(ZroGraduation.NotSeedixCoin.selector);
        g.graduate(COIN);
        vm.prank(SAFE);
        g.allowCoin(COIN, true);
        vm.prank(SAFE);
        address adapter = g.graduate(COIN);
        assertEq(g.adapterOf(COIN), adapter);
        vm.prank(SAFE);
        ILiveExcluded(TRACKER).setExcluded(adapter, true);
        assertTrue(ILiveExcluded(TRACKER).excluded(adapter));
    }

    function test_R_M02_newTrackerStillNeedsAnExcluder() public {
        LegacyLauncher legacy = new LegacyLauncher();
        TestLzEndpoint endpoint = new TestLzEndpoint(1, 0.01 ether);
        ZroWeightTracker tracker = new ZroWeightTracker(address(this), address(0), address(0), address(0));
        ZroGraduation g =
            new ZroGraduation(address(endpoint), address(this), address(0x71), address(tracker), address(legacy));
        g.allowCoin(COIN, true);
        vm.expectRevert(ZroGraduation.CannotExclude.selector);
        g.graduate(COIN);
    }
}
