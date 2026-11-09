// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Leaf and pair hashing for Kickback tests. Pairs are sorted the way OpenZeppelin verifies them.
library KickTree {
    function leaf(
        uint256 chainId,
        address distributor,
        address coin,
        address pair,
        uint64 epochId,
        address account,
        uint256 amount
    ) internal pure returns (bytes32) {
        return keccak256(
            bytes.concat(keccak256(abi.encode(chainId, distributor, coin, pair, epochId, account, amount)))
        );
    }

    function pairHash(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}
