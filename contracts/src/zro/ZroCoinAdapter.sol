// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EnforcedOptionParam} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppOptionsType3.sol";
import {SendParam} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {OFTAdapter} from "@layerzerolabs/oft-evm/contracts/OFTAdapter.sol";
import {OftRecipient} from "./OftRecipient.sol";

interface ILaunchedCoins {
    function isLaunchedCoin(address coin) external view returns (bool);
}

interface IGraduationView {
    function launcher() external view returns (address);
    function allowedCoin(address coin) external view returns (bool);
}

/// @notice Home-chain lockbox for one Seedix coin. `msg.sender` must be the graduation contract,
///         and the coin must be known to the launcher that graduation stores, or to graduation's
///         allowlist. The caller does not pass a graduation address. The OApp owner is the
///         timelock, so `setDelegate` is timelock-only. Peers and enforced options are too.
///         The delay itself is the timelock's `getMinDelay`.
contract ZroCoinAdapter is OFTAdapter {
    error NotTimelock();
    error NotGraduation();
    error ZeroAddress();

    address public immutable timelock;

    constructor(address token, address endpoint, address delegate, address timelock_)
        OFTAdapter(token, endpoint, delegate)
        Ownable(timelock_)
    {
        if (token == address(0) || timelock_ == address(0) || delegate == address(0)) revert ZeroAddress();
        timelock = timelock_;
        if (!_fromGraduation(token)) revert NotGraduation();
    }

    function setPeer(uint32 eid, bytes32 peer) public override {
        if (msg.sender != timelock) revert NotTimelock();
        _setPeer(eid, peer);
    }

    function setEnforcedOptions(EnforcedOptionParam[] calldata enforced) public override {
        if (msg.sender != timelock) revert NotTimelock();
        _setEnforcedOptions(enforced);
    }

    /// @dev `send` and `quoteSend` are external, so the recipient check lives on the shared builder.
    function _buildMsgAndOptions(SendParam calldata sendParam, uint256 amountLD)
        internal
        view
        override
        returns (bytes memory message, bytes memory options)
    {
        OftRecipient.check(sendParam.to);
        return super._buildMsgAndOptions(sendParam, amountLD);
    }

    function _credit(address to, uint256 amountLD, uint32 srcEid) internal override returns (uint256) {
        if (to == address(0)) revert OftRecipient.BadRecipient();
        return super._credit(to, amountLD, srcEid);
    }

    /// @notice Pulls ETH that a LayerZero option delivered here and nowhere else can withdraw.
    function sweep(address payable to) external {
        if (msg.sender != timelock) revert NotTimelock();
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = address(this).balance;
        if (bal == 0) revert ZeroAddress();
        (bool ok,) = to.call{value: bal}("");
        if (!ok) revert ZeroAddress();
    }

    /// @dev The launcher address is read from the graduation contract that is constructing this
    ///      adapter. A deployer-supplied graduation address is not an argument.
    function _fromGraduation(address token) internal view returns (bool) {
        address launcher;
        try IGraduationView(msg.sender).launcher() returns (address l) {
            launcher = l;
        } catch {
            return false;
        }
        if (launcher == address(0)) return false;
        try ILaunchedCoins(launcher).isLaunchedCoin(token) returns (bool launched) {
            if (launched) return true;
        } catch {}
        try IGraduationView(msg.sender).allowedCoin(token) returns (bool allowed) {
            return allowed;
        } catch {
            return false;
        }
    }
}
