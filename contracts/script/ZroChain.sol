// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";

/// @notice Chain addresses are read from `config/chains/<chainId>.json` or from the environment.
///         Nothing in this file is a deployment address.
///
///         Base Sepolia (84532) Uniswap v4 addresses are the ones published at
///         https://docs.uniswap.org/contracts/v4/deployments
///         PoolManager 0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408
///         PositionManager 0x4b2c77d209d3405f41a037ec6c77f7f5b8e2ca80
///         Universal Router 0x492e6456d9528771018deb9e87ef7750ef184104
///
///         The LayerZero EndpointV2 for Base Sepolia is
///         0x6edce65403992e310a62460808c4b910d972f10f
///         (EID 40245), from https://metadata.layerzero-api.com/v1/metadata
///
///         WETH is the Base predeploy 0x4200000000000000000000000000000000000006
///         https://docs.base.org/base-chain/network-information/base-contracts
///
///         Safe v1.4.1 factory, L2 singleton, and fallback handler are the canonical CREATE2
///         addresses from https://github.com/safe-global/safe-deployments/tree/main/src/assets/v1.4.1
///         The deploy script uses them only when the factory has code.
abstract contract ZroChain is Script {
    error Forbidden(uint256 chainId);

    struct Addrs {
        address poolManager;
        address positionManager;
        address router;
        address weth;
        address lzEndpoint;
        uint256 lzEid;
        address safeProxyFactory;
        address safeSingleton;
        address safeFallbackHandler;
    }

    function _load() internal view returns (Addrs memory c) {
        uint256 chainId = block.chainid;
        if (chainId != 84532 && chainId != 31337) revert Forbidden(chainId);
        if (chainId == 84532) {
            string memory json = vm.readFile("config/chains/84532.json");
            c.poolManager = vm.parseJsonAddress(json, ".poolManager");
            c.positionManager = vm.parseJsonAddress(json, ".positionManager");
            c.router = vm.parseJsonAddress(json, ".router");
            c.weth = vm.parseJsonAddress(json, ".weth");
            c.lzEndpoint = vm.parseJsonAddress(json, ".lzEndpoint");
            c.lzEid = vm.parseJsonUint(json, ".lzEid");
            c.safeProxyFactory = vm.parseJsonAddress(json, ".safeProxyFactory");
            c.safeSingleton = vm.parseJsonAddress(json, ".safeSingleton");
            c.safeFallbackHandler = vm.parseJsonAddress(json, ".safeFallbackHandler");
        }
        c.poolManager = vm.envOr("UNISWAP_V4_POOL_MANAGER", c.poolManager);
        c.positionManager = vm.envOr("UNISWAP_V4_POSITION_MANAGER", c.positionManager);
        c.router = vm.envOr("UNISWAP_V4_ROUTER", c.router);
        c.weth = vm.envOr("WETH", c.weth);
        c.lzEndpoint = vm.envOr("LZ_ENDPOINT", c.lzEndpoint);
        c.lzEid = vm.envOr("LZ_EID", c.lzEid);
    }
}
