// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @notice Mainnet schedule check. Testnet chain ids return immediately. The canonical ZRO address
///         is the one verified on Ethereum, Base, and Arbitrum. The delay and the roles are read
///         from the deployed timelock. A script that only claims those values does not pass.
///         Chain 99901 (Zero) is included with Ethereum, Base, and Arbitrum. Deploy this only on
///         a mainnet path. The Base Sepolia deploy does not construct it.
contract ZroMainnetGuard {
    error MainnetConfig();

    address public constant CANONICAL_ZRO = 0x6985884C4392D348587B19cb9eAAf157F13271cd;
    uint256 public constant MIN_DELAY = 48 hours;
    uint256 public constant MIN_CLAIM_WINDOW = 30 days;

    function canonical() external pure returns (address) {
        return CANONICAL_ZRO;
    }

    function minDelay() external pure returns (uint256) {
        return MIN_DELAY;
    }

    function isMainnet(uint256 chainId) public pure returns (bool) {
        return chainId == 1 || chainId == 8453 || chainId == 42161 || chainId == 99901;
    }

    /// @notice `zro` must be the canonical token and must have code. `timelock` is read for
    ///         `getMinDelay` and for roles. The Safe must be a proposer. The deployer must not
    ///         hold proposer, executor, canceller, or admin. TimelockController cannot enumerate
    ///         every proposer, so this does not prove the Safe is the only one.
    function assertReady(uint256 chainId, address zro, address timelock, address safe, address deployer) external view {
        if (!isMainnet(chainId)) return;
        if (zro != CANONICAL_ZRO || zro.code.length == 0) revert MainnetConfig();
        if (timelock.code.length == 0 || safe == address(0) || safe == deployer) revert MainnetConfig();
        TimelockController tl = TimelockController(payable(timelock));
        if (tl.getMinDelay() < MIN_DELAY) revert MainnetConfig();
        if (!tl.hasRole(tl.PROPOSER_ROLE(), safe)) revert MainnetConfig();
        if (tl.hasRole(tl.PROPOSER_ROLE(), deployer)) revert MainnetConfig();
        if (tl.hasRole(tl.EXECUTOR_ROLE(), deployer)) revert MainnetConfig();
        if (tl.hasRole(tl.CANCELLER_ROLE(), deployer)) revert MainnetConfig();
        if (tl.hasRole(tl.DEFAULT_ADMIN_ROLE(), deployer)) revert MainnetConfig();
    }

    /// @notice A mainnet claim window is at least 30 days. The vault snapshots whatever value is
    ///         set at `fund`; this stops a mainnet config from funding a shorter window.
    function assertClaimWindow(uint256 chainId, uint256 window) external pure {
        if (!isMainnet(chainId)) return;
        if (window < MIN_CLAIM_WINDOW) revert MainnetConfig();
    }
}
