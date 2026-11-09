// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Arbitrum Orbit precompile. Elysium's `block` counter is the parent chain's.
///         If an L2 block id is ever required, call this. Do not read the parent counter from Solidity.
interface IArbSys {
    function arbBlockNumber() external view returns (uint256);
}

library ArbSysClock {
    /// @dev Precompile address on every Arbitrum Orbit chain, including Elysium.
    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000064;

    function l2BlockNumber() internal view returns (uint256) {
        return IArbSys(PRECOMPILE).arbBlockNumber();
    }
}
