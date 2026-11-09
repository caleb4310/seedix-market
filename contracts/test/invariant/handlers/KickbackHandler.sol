// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {KickbackDistributor} from "../../../src/kickback/KickbackDistributor.sol";

/// @notice Invariant actor for one funded Kickback round. Reverts are avoided so the fuzzer
///         keeps the round inside the conservation checks.
contract KickbackHandler {
    KickbackDistributor public immutable dist;
    PoolId public immutable poolId;
    uint64 public immutable epoch;
    address[4] public who;
    uint256[4] public amt;
    bytes32[][4] internal proof;

    constructor(
        KickbackDistributor dist_,
        PoolId poolId_,
        uint64 epoch_,
        address[4] memory who_,
        uint256[4] memory amt_,
        bytes32[] memory p0,
        bytes32[] memory p1,
        bytes32[] memory p2,
        bytes32[] memory p3
    ) {
        dist = dist_;
        poolId = poolId_;
        epoch = epoch_;
        who = who_;
        amt = amt_;
        _copy(0, p0);
        _copy(1, p1);
        _copy(2, p2);
        _copy(3, p3);
    }

    function push0() external {
        _push(0);
    }

    function push1() external {
        _push(1);
    }

    function push2() external {
        _push(2);
    }

    function push3() external {
        _push(3);
    }

    function pushAll() external {
        for (uint256 i; i < 4; ++i) {
            _push(i);
        }
    }

    function sealRound() external {
        if (dist.roundClosed(poolId, epoch)) return;
        dist.seal(poolId, epoch);
    }

    function _push(uint256 i) internal {
        if (dist.roundClosed(poolId, epoch)) return;
        if (dist.claimed(poolId, epoch, who[i])) return;
        address[] memory accounts = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        bytes32[][] memory proofs = new bytes32[][](1);
        accounts[0] = who[i];
        amounts[0] = amt[i];
        uint256 n = proof[i].length;
        bytes32[] memory leafProof = new bytes32[](n);
        for (uint256 j; j < n; ++j) {
            leafProof[j] = proof[i][j];
        }
        proofs[0] = leafProof;
        dist.push(poolId, epoch, accounts, amounts, proofs);
    }

    function _copy(uint256 i, bytes32[] memory src) internal {
        uint256 n = src.length;
        for (uint256 j; j < n; ++j) {
            proof[i].push(src[j]);
        }
    }
}
