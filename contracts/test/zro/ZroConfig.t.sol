// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

/// @notice The Base Sepolia file is the source of the addresses. This only checks the shape.
contract ZroConfigTest is Test {
    function test_baseSepoliaFile() public view {
        string memory json = vm.readFile("config/chains/84532.json");
        assertEq(vm.parseJsonUint(json, ".chainId"), 84532);
        assertEq(vm.parseJsonUint(json, ".lzEid"), 40245);
        assertEq(vm.parseJsonString(json, ".feeMode"), "on_top");
        assertEq(vm.parseJsonUint(json, ".protocolFeeBps"), 100);
        assertTrue(vm.parseJsonAddress(json, ".poolManager") != address(0));
        assertTrue(vm.parseJsonAddress(json, ".positionManager") != address(0));
        assertTrue(vm.parseJsonAddress(json, ".router") != address(0));
        assertTrue(vm.parseJsonAddress(json, ".weth") != address(0));
        assertTrue(vm.parseJsonAddress(json, ".lzEndpoint") != address(0));
        assertTrue(vm.parseJsonAddress(json, ".safeProxyFactory") != address(0));
        assertTrue(vm.parseJsonAddress(json, ".safeSingleton") != address(0));
        assertTrue(vm.parseJsonAddress(json, ".safeFallbackHandler") != address(0));
        assertEq(vm.parseJsonString(json, ".sources.uniswapV4"), "https://docs.uniswap.org/contracts/v4/deployments");
        assertEq(
            vm.parseJsonString(json, ".sources.layerZeroMetadata"), "https://metadata.layerzero-api.com/v1/metadata"
        );
    }
}
