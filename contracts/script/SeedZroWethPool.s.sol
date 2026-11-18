// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {RouteSeeder} from "../src/launch/RouteSeeder.sol";
import {ZroChain} from "./ZroChain.sol";

/// @notice Seeds a hookless ZRO/WETH v4 pool. Addresses come from chain config or the environment.
///         The broadcaster must already hold ZRO and WETH. PRIVATE_KEY is never logged.
///         Base Sepolia uses the Uniswap v4 PoolManager from the deployments doc. See ZroChain.sol.
contract SeedZroWethPool is ZroChain {
    error Amount();

    function run() external {
        ZroChain.Addrs memory chain = _load();
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address zro = vm.envAddress("ZRO_TOKEN");
        uint256 zroAmount = vm.envUint("SEED_ZRO_AMOUNT");
        uint256 wethAmount = vm.envUint("SEED_WETH_AMOUNT");
        if (zroAmount == 0 || wethAmount == 0 || chain.poolManager == address(0) || chain.weth == address(0)) {
            revert Amount();
        }
        address broadcaster = vm.addr(pk);

        vm.startBroadcast(pk);
        RouteSeeder seeder = new RouteSeeder();
        IERC20(zro).approve(address(seeder), zroAmount);
        IERC20(chain.weth).approve(address(seeder), wethAmount);
        // seedWide counts WETH spent from the seeder's own balance. An approval alone pays
        // the pool from the caller and reports zero spent.
        IERC20(zro).transfer(address(seeder), zroAmount);
        IERC20(chain.weth).transfer(address(seeder), wethAmount);
        int24 widthSteps = int24(int256(vm.envOr("SEED_WIDTH_STEPS", uint256(1))));
        if (widthSteps < 1) widthSteps = 1;
        (PoolKey memory key, uint256 spent) =
            seeder.seedWide(IPoolManager(chain.poolManager), chain.weth, zro, wethAmount, widthSteps);
        vm.stopBroadcast();

        console2.log("seeder", address(seeder));
        console2.log("wethSpent", spent);
        console2.log("currency0", Currency.unwrap(key.currency0));
        console2.log("currency1", Currency.unwrap(key.currency1));
        console2.log("broadcaster", broadcaster);
    }
}
