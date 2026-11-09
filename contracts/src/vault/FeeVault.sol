// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SeedixRoles} from "../access/SeedixRoles.sol";
import {SeedixConstants as C} from "../libraries/SeedixConstants.sol";
import {LaunchHook} from "../hook/LaunchHook.sol";

/// @notice Pull claims. The fee-wallet address changes only through the 48-hour timelock.
///         This contract does not custody pair tokens. A rebasing pair changes the PoolManager
///         balance under the hook's ERC-6909 claims, and this vault cannot sweep that.
///         Creator pair and creator coin are claimed separately so a paused pair token
///         cannot freeze the coin claim.
contract FeeVault {
    error NotAdmin();
    error NotRecipient();
    error BadWallet();
    error NotInitializer();
    error Nothing();

    event CreatorClaimed(PoolId indexed poolId, address indexed to, bool pairSide, uint256 amount);
    event PlatformWalletClaimed(address indexed pair, address indexed to, uint256 amount);
    event FeeWalletQueued(address indexed next, uint256 eta);
    event FeeWalletChanged(address indexed previous, address indexed next);

    SeedixRoles public immutable roles;
    address public immutable initializer;
    LaunchHook public hook;
    address public feeWallet;
    uint256 public feeWalletNonce;

    constructor(SeedixRoles roles_, address feeWallet_, address initializer_) {
        if (feeWallet_ == address(0) || feeWallet_ == C.DEAD) revert BadWallet();
        if (initializer_ == address(0)) revert NotInitializer();
        roles = roles_;
        feeWallet = feeWallet_;
        initializer = initializer_;
    }

    function setHook(LaunchHook hook_) external {
        if (msg.sender != initializer || address(hook) != address(0)) revert NotInitializer();
        hook = hook_;
    }

    function claimCreator(PoolId id, bool pairSide) external {
        (,,,,,, address recipient) = hook.config(id);
        if (msg.sender != recipient) revert NotRecipient();
        uint256 amount;
        if (pairSide) {
            (uint128 creatorPair,,,,) = hook.pots(id);
            amount = creatorPair;
            if (amount == 0) revert Nothing();
            hook.debitCreatorPair(id, amount, recipient);
        } else {
            (, uint128 creatorCoin,,,) = hook.pots(id);
            amount = creatorCoin;
            if (amount == 0) revert Nothing();
            hook.debitCreatorCoin(id, amount, recipient);
        }
        emit CreatorClaimed(id, recipient, pairSide, amount);
    }

    function claimPlatformWallet(Currency pair) external {
        uint256 amount = hook.platformWallet(pair);
        if (amount == 0) revert Nothing();
        address to = feeWallet;
        hook.debitPlatformWallet(pair, amount, to);
        emit PlatformWalletClaimed(Currency.unwrap(pair), to, amount);
    }

    function queueFeeWallet(address next) external returns (bytes32 salt) {
        if (msg.sender != roles.admin()) revert NotAdmin();
        if (next == address(0) || next == C.DEAD) revert BadWallet();
        bytes memory data = abi.encodeCall(this.setFeeWallet, (next));
        TimelockController tl = roles.timelock();
        uint256 delay = tl.getMinDelay();
        salt = keccak256(abi.encode("seedix.feeWallet", next, feeWalletNonce));
        feeWalletNonce += 1;
        tl.schedule(address(this), 0, data, bytes32(0), salt, delay);
        emit FeeWalletQueued(next, block.timestamp + delay);
    }

    function setFeeWallet(address next) external {
        if (msg.sender != address(roles.timelock())) revert NotAdmin();
        if (next == address(0) || next == C.DEAD) revert BadWallet();
        emit FeeWalletChanged(feeWallet, next);
        feeWallet = next;
    }
}
