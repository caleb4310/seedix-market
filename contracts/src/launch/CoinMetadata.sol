// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Launcher} from "./Launcher.sol";

/// @notice Points a launched coin at an IPFS document. The indexer re-reads that document
///         and drops any field that fails the metadata rules. This contract does not interpret the JSON.
contract CoinMetadata {
    error NotCreator();
    error BadCid();

    Launcher public immutable launcher;

    mapping(bytes32 => string) public cidOf;

    event MetadataPinned(bytes32 indexed poolId, address indexed creator, string cid);

    constructor(Launcher launcher_) {
        launcher = launcher_;
    }

    function pin(bytes32 poolId, string calldata cid) external {
        if (msg.sender != launcher.creatorOf(PoolId.wrap(poolId))) revert NotCreator();
        uint256 n = bytes(cid).length;
        if (n < 10 || n > 128) revert BadCid();
        for (uint256 i; i < n; ++i) {
            bytes1 c = bytes(cid)[i];
            bool ok = (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A);
            if (!ok) revert BadCid();
        }
        cidOf[poolId] = cid;
        emit MetadataPinned(poolId, msg.sender, cid);
    }
}
