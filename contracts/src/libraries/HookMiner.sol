// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice CREATE2 salt search. Adapted from Uniswap v4-periphery test/shared/HookMiner.sol (MIT).
///         The init-code hash is computed once so mining stays inside a deploy transaction's gas.
library HookMiner {
    uint160 internal constant FLAG_MASK = (1 << 14) - 1;
    uint256 internal constant MAX_LOOP = 80_000;

    error SaltNotFound();

    function find(address deployer, uint160 flags, bytes memory creationCode, bytes memory constructorArgs)
        internal
        view
        returns (address hook, bytes32 salt)
    {
        flags &= FLAG_MASK;
        bytes32 initHash = keccak256(abi.encodePacked(creationCode, constructorArgs));
        for (uint256 i; i < MAX_LOOP; ++i) {
            hook = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, bytes32(i), initHash)))));
            if (uint160(hook) & FLAG_MASK == flags && hook.code.length == 0) {
                return (hook, bytes32(i));
            }
        }
        revert SaltNotFound();
    }
}
