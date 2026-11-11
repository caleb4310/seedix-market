// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";
import {SeedixRoles} from "../src/access/SeedixRoles.sol";
import {BuybackExecutor} from "../src/buyback/BuybackExecutor.sol";
import {DeploySeedix} from "../script/Deploy.s.sol";
import {KickbackDistributor} from "../src/kickback/KickbackDistributor.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {MockXStock} from "../src/token/MockXStock.sol";
import {LaunchHook} from "../src/hook/LaunchHook.sol";
import {FeeVault} from "../src/vault/FeeVault.sol";
import {Fixture} from "./utils/Fixture.sol";

contract MainnetGuardTest is Test {
    function _roles() internal returns (SeedixRoles roles) {
        address[] memory one = new address[](1);
        one[0] = address(this);
        TimelockController tl = new TimelockController(48 hours, one, one, address(this));
        roles = new SeedixRoles(tl, address(this), address(0));
    }

    function test_testnetMayUseZeroKeeperDelay() public {
        BuybackExecutor ex = new BuybackExecutor(_roles(), Currency.wrap(address(1)), address(this), 0, 0);
        ex.setKeeper(address(0xBEEF));
        assertEq(ex.keeper(), address(0xBEEF));
    }

    function test_mainnetKeeperDelayIsFortyEightHours() public {
        vm.chainId(99901);
        SeedixRoles roles = _roles();
        vm.expectRevert(abi.encodeWithSelector(BuybackExecutor.KeeperDelayTooShort.selector, 0, 48 hours));
        new BuybackExecutor(roles, Currency.wrap(address(1)), address(this), 0, 0);

        BuybackExecutor ex = new BuybackExecutor(roles, Currency.wrap(address(1)), address(this), 0, 48 hours);
        vm.expectRevert(BuybackExecutor.ImmediateKeeperDisabled.selector);
        ex.setKeeper(address(0xBEEF));
        ex.proposeKeeper(address(0xBEEF));
        vm.warp(block.timestamp + 48 hours - 1);
        vm.expectRevert(BuybackExecutor.TooSoon.selector);
        ex.applyKeeper();
        vm.warp(block.timestamp + 1);
        ex.applyKeeper();
        assertEq(ex.keeper(), address(0xBEEF));
    }

    function test_mainnetAdminCannotBeTheFeeWallet() public {
        DeploySeedix script = new DeploySeedix();
        vm.chainId(99901);
        vm.expectRevert(abi.encodeWithSelector(DeploySeedix.AdminIsFeeWallet.selector, C.FEE_WALLET));
        script.requireMainnetAdmin(C.FEE_WALLET);
        uint256 delay = script.requireMainnetAdmin(address(0xA11CE));
        assertEq(delay, 48 hours);
    }

    function test_mainnetRolesMustBeDistinct() public {
        DeploySeedix script = new DeploySeedix();
        vm.chainId(99901);
        DeploySeedix.MainnetRoles memory roles = DeploySeedix.MainnetRoles({
            admin: address(0xA11),
            guardian: address(0xA11),
            feeWallet: address(0xF33),
            proposer: address(0xB0B),
            publisher: address(0xB0B1),
            keeper: address(0xB0B2)
        });
        vm.expectRevert(abi.encodeWithSelector(DeploySeedix.RolesCollide.selector, address(0xA11), address(0xA11)));
        script.requireMainnetRoles(roles);
        roles.guardian = address(0x6A2D);
        roles.feeWallet = C.FEE_WALLET;
        vm.expectRevert(abi.encodeWithSelector(DeploySeedix.FeeWalletReuse.selector, C.FEE_WALLET));
        script.requireMainnetRoles(roles);
    }

    function test_kickbackKeeperIsTimelockedOffTestnet() public {
        vm.chainId(99901);
        KickbackDistributor dist = new KickbackDistributor(
            _roles(), address(0xB0B), 1000 ether, 2000 ether, 100 ether, address(this), 48 hours
        );
        vm.expectRevert(KickbackDistributor.ImmediateKeeperDisabled.selector);
        dist.setKeeper(address(0xBEEF));
        dist.proposeKeeper(address(0xBEEF));
        vm.warp(block.timestamp + 48 hours - 1);
        vm.expectRevert(KickbackDistributor.TooSoon.selector);
        dist.applyKeeper();
        vm.warp(block.timestamp + 1);
        dist.applyKeeper();
        assertEq(dist.keeper(), address(0xBEEF));
        assertEq(dist.recipientCap(), 100 ether);
    }

    function test_mainnetDeployUsesThePassedPoolManager() public {
        vm.chainId(99901);
        PoolManager manager = new PoolManager(address(0));
        MockXStock wrapped = new MockXStock("Wrapped HYPE", "WHYPE", 18, address(this));
        vm.etch(address(0x1111), hex"01");
        vm.etch(address(0x2222), hex"01");
        vm.etch(address(0x3333), hex"01");
        vm.etch(address(0x4444), hex"01");
        DeploySeedix script = new DeploySeedix();
        address[] memory pairs = new address[](1);
        pairs[0] = address(wrapped);
        script.deployMainnet(
            1,
            DeploySeedix.MainnetRoles({
                admin: address(0xA11),
                guardian: address(0x6A2D),
                feeWallet: address(0xF33),
                proposer: address(0xB0B),
                publisher: address(0xB0B1),
                keeper: address(0xB0B2)
            }),
            DeploySeedix.CanonicalUniswap({
                poolManager: address(manager),
                positionManager: address(0x1111),
                stateView: address(0x2222),
                quoter: address(0x3333),
                whype: address(wrapped),
                permit2: address(0x4444)
            }),
            pairs
        );
        (,,, address roles, address vault,, address distributor, address hook,,) = script.last();
        assertEq(KickbackDistributor(distributor).publisher(), address(0xB0B1));
        assertEq(address(LaunchHook(hook).poolManager()), address(manager));
        assertEq(SeedixRoles(roles).guardian(), address(0x6A2D));
        assertEq(SeedixRoles(roles).admin(), address(0xA11));
        assertEq(FeeVault(vault).feeWallet(), address(0xF33));
    }
}

contract KickbackMainnetTest is Fixture {
    function test_kickbackLaunchAllowedOnMainnet() public {
        vm.chainId(99901);
        (address coin,) = d.launcher.launch(_params(address(whype), 1, 0, address(0)));
        assertTrue(coin != address(0));
    }
}
