// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {ZroTaxSwapper} from "../src/zro/ZroTaxSwapper.sol";
import {ZroRewardVault} from "../src/zro/ZroRewardVault.sol";

/// @notice Keeper harvest then holder claim, after the tax hour has closed and the 30-minute TWAP is ready.
///         Local-only. PRIVATE_KEY is never logged.
contract SmokeHarvest is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address swapperAddr = vm.envAddress("SWAPPER");
        address vaultAddr = vm.envAddress("VAULT");
        address zro = vm.envAddress("ZRO_TOKEN");
        PoolId id = PoolId.wrap(vm.envBytes32("POOL_ID"));
        address holder = vm.addr(pk);

        ZroTaxSwapper swapper = ZroTaxSwapper(swapperAddr);
        ZroRewardVault vault = ZroRewardVault(vaultAddr);
        (uint256 holderIn, uint64 fromEpoch, uint64 toEpoch) = swapper.nextHolderIn(id);
        console2.log("holderIn", holderIn);
        console2.log("fromEpoch", fromEpoch);
        console2.log("toEpoch", toEpoch);
        console2.log("zroBefore", IERC20(zro).balanceOf(holder));

        uint256 minOut = 0;
        if (holderIn > 0) {
            (uint256 twapOut, uint256 floor, uint256 lower, uint256 upper) = swapper.quote(holderIn);
            console2.log("twapOut", twapOut);
            console2.log("floor", floor);
            console2.log("lower", lower);
            console2.log("upper", upper);
            // The hookless ZRO/WETH pool charges a 0.30% fee, so raw TWAP out is too tight.
            // The keeper's minOut still has to sit in [lower, upper]; the floor is the lower bound.
            minOut = floor;
            if (minOut < lower) minOut = lower;
            if (minOut > upper) minOut = upper;
        }

        vm.startBroadcast(pk);
        uint256 zroOut = 0;
        if (holderIn > 0 || true) {
            zroOut = swapper.harvest(id, minOut);
        }
        uint256 claimed = 0;
        if (fromEpoch != 0 || toEpoch != 0) {
            claimed = vault.claim(id, fromEpoch);
        }
        vm.stopBroadcast();

        console2.log("zroOut", zroOut);
        console2.log("claimed", claimed);
        console2.log("zroAfter", IERC20(zro).balanceOf(holder));
        console2.log("minOutUsed", minOut);
    }
}
