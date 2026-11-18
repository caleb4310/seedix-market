// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {ZroTaxSwapper} from "../src/zro/ZroTaxSwapper.sol";

interface ISafe {
    function nonce() external view returns (uint256);
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) external view returns (bytes32);
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool success);
}

/// @notice 1-of-1 Safe exec of ZroTaxSwapper.registerPool. Local-only. PRIVATE_KEY is never logged.
contract SafeRegisterZroPool is Script {
    using PoolIdLibrary for PoolKey;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address safe = vm.envAddress("SAFE");
        address swapper = vm.envAddress("SWAPPER");
        address weth = vm.envAddress("WETH");
        address zro = vm.envAddress("ZRO_TOKEN");
        (Currency c0, Currency c1) = uint160(weth) < uint160(zro)
            ? (Currency.wrap(weth), Currency.wrap(zro))
            : (Currency.wrap(zro), Currency.wrap(weth));
        PoolKey memory key =
            PoolKey({currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: IHooks(address(0))});
        bytes memory data = abi.encodeCall(ZroTaxSwapper.registerPool, (key));
        uint256 nonce = ISafe(safe).nonce();
        bytes32 txHash = ISafe(safe).getTransactionHash(swapper, 0, data, 0, 0, 0, 0, address(0), address(0), nonce);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, txHash);
        bytes memory signatures = abi.encodePacked(r, s, v);

        vm.startBroadcast(pk);
        bool ok = ISafe(safe).execTransaction(swapper, 0, data, 0, 0, 0, 0, address(0), payable(address(0)), signatures);
        require(ok, "safe exec failed");
        vm.stopBroadcast();

        console2.log("safe", safe);
        console2.log("swapper", swapper);
        console2.log("poolSet", ZroTaxSwapper(swapper).poolSet() ? 1 : 0);
        console2.log("poolId");
        console2.logBytes32(PoolId.unwrap(key.toId()));
    }
}
