// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Split `total` across hour weights. Zero weights get nothing. The last non-zero weight
///         receives the remainder, so the shares sum to `total` and rounding dust is not stuck.
library ZroRoundSplit {
    function shares(uint256 total, uint256[] memory weights) internal pure returns (uint256[] memory out) {
        uint256 n = weights.length;
        out = new uint256[](n);
        if (total == 0 || n == 0) return out;
        uint256 sum = 0;
        uint256 last = 0;
        bool found = false;
        for (uint256 i; i < n; ++i) {
            if (weights[i] == 0) continue;
            sum += weights[i];
            last = i;
            found = true;
        }
        if (!found || sum == 0) return out;
        uint256 allocated = 0;
        for (uint256 i; i < n; ++i) {
            if (weights[i] == 0 || i == last) continue;
            uint256 part = total * weights[i] / sum;
            out[i] = part;
            allocated += part;
        }
        out[last] = total - allocated;
    }
}
