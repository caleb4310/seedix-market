// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @notice Single admin, plus a narrowly scoped guardian role.
///         At deploy the guardian address IS the admin, so one key can pause and cancel immediately.
///         `setGuardian` is timelocked, so the role can later move to another key without a redeploy.
///         Neither role can move pots or change fee rates. The fee wallet change is a separate 48h action.
contract SeedixRoles {
    error NotAdmin();
    error NotTimelock();
    error ZeroAddress();

    TimelockController public immutable timelock;
    address public admin;
    address public guardian;

    event AdminChanged(address indexed previous, address indexed next);
    event GuardianChanged(address indexed previous, address indexed next);
    event GuardianQueued(address indexed next, uint256 eta);

    constructor(TimelockController timelock_, address admin_) {
        if (address(timelock_) == address(0) || admin_ == address(0)) revert ZeroAddress();
        timelock = timelock_;
        admin = admin_;
        guardian = admin_;
        emit GuardianChanged(address(0), admin_);
        emit AdminChanged(address(0), admin_);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyTimelock() {
        if (msg.sender != address(timelock)) revert NotTimelock();
        _;
    }

    function setAdmin(address next) external onlyTimelock {
        if (next == address(0)) revert ZeroAddress();
        emit AdminChanged(admin, next);
        admin = next;
    }

    function setGuardian(address next) external onlyTimelock {
        if (next == address(0)) revert ZeroAddress();
        emit GuardianChanged(guardian, next);
        guardian = next;
    }

    /// @dev Admin queues a split of the guardian role. The new key cannot act until the timelock delay.
    function queueSetGuardian(address next) external onlyAdmin {
        if (next == address(0)) revert ZeroAddress();
        bytes memory data = abi.encodeCall(this.setGuardian, (next));
        uint256 delay = timelock.getMinDelay();
        timelock.schedule(address(this), 0, data, bytes32(0), bytes32(uint256(1)), delay);
        emit GuardianQueued(next, block.timestamp + delay);
    }
}
