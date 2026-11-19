// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Script.sol";
import {ZroGraduation} from "../src/zro/ZroGraduation.sol";
import {SafeBatch} from "./SafeBatch.sol";

/// @notice Live Base Sepolia batch for one coin. The launcher has no `isLaunchedCoin`, and the
///         live tracker has no `excluder()`. Graduation is deployed with `tracker = address(0)`.
///         This writes three Safe transactions and does not broadcast:
///         allowCoin, graduate, then the live tracker's `setExcluded(adapter, true)`.
///         The adapter is the graduation contract's next CREATE address, so the third call can
///         name it before graduate runs. Run `VerifyGraduateLive` after the Safe executes.
contract SafeGraduateLive is SafeBatch {
    function run() external {
        ZroGraduation grad = ZroGraduation(vm.envAddress("GRADUATION"));
        address tracker = vm.envAddress("TRACKER");
        address coin = vm.envAddress("COIN");
        uint256 chainId = vm.envOr("CHAIN_ID", block.chainid);
        address adapter = vm.computeCreateAddress(address(grad), vm.getNonce(address(grad)));
        address[] memory to = new address[](3);
        bytes[] memory data = new bytes[](3);
        to[0] = address(grad);
        data[0] = abi.encodeCall(ZroGraduation.allowCoin, (coin, true));
        to[1] = address(grad);
        data[1] = abi.encodeCall(ZroGraduation.graduate, (coin));
        to[2] = tracker;
        data[2] = abi.encodeWithSignature("setExcluded(address,bool)", adapter, true);
        _writeBatch(
            vm.envOr("SAFE_BATCH_OUT", string("out/safe/graduate-live.json")), chainId, "graduate-live", to, data
        );
        console2.log("predicted adapter", adapter);
    }
}
