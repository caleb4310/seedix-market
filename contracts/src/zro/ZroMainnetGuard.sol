// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Mainnet schedule check. Testnet chain ids return immediately. The canonical ZRO address
///         is the one verified on Ethereum, Base, and Arbitrum. Scripts must not deploy MockZRO there.
contract ZroMainnetGuard {
    error MainnetConfig();

    address public constant CANONICAL_ZRO = 0x6985884C4392D348587B19cb9eAAf157F13271cd;
    uint256 public constant MIN_DELAY = 48 hours;

    function canonical() external pure returns (address) {
        return CANONICAL_ZRO;
    }

    function minDelay() external pure returns (uint256) {
        return MIN_DELAY;
    }

    function assertReady(uint256 chainId, address zro, uint256 delay, address proposer, address safe, address deployer)
        external
        pure
    {
        if (chainId != 1 && chainId != 8453 && chainId != 42161) return;
        if (zro != CANONICAL_ZRO) revert MainnetConfig();
        if (delay < MIN_DELAY) revert MainnetConfig();
        if (proposer != safe || deployer == proposer) revert MainnetConfig();
    }
}
