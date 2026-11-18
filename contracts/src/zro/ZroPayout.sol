// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {OFTReceipt, SendParam} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {
    MessagingFee,
    MessagingReceipt
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import {IZroPayout} from "./IZroPayout.sol";

interface IZroOft {
    function quoteSend(SendParam calldata sendParam, bool payInLzToken) external view returns (MessagingFee memory);

    function send(SendParam calldata sendParam, MessagingFee calldata fee, address refundAddress)
        external
        payable
        returns (MessagingReceipt memory, OFTReceipt memory);
}

/// @notice Sends a vault claim through the ZRO OFT. Only the vault may call `payout`.
///         `msg.value` must cover the LayerZero native fee. Anything above that quote is refunded
///         to the holder. The OFT also names the holder as its own refund address, so a fee the
///         endpoint does not consume goes back to the same account. Accounting stays in the vault,
///         which marks the claim before this call and reverts the mark if this call reverts.
contract ZroPayout is IZroPayout {
    using SafeERC20 for IERC20;

    error NotVault();
    error FeeShort();
    error RefundFailed();
    error Reentered();

    address public immutable vault;
    uint256 private _locked;

    constructor(address vault_) {
        if (vault_ == address(0)) revert NotVault();
        vault = vault_;
    }

    function quote(address zro, address to, uint256 amount, uint32 dstEid, bytes calldata options)
        public
        view
        returns (uint256 nativeFee)
    {
        nativeFee = IZroOft(zro).quoteSend(_param(to, amount, dstEid, options), false).nativeFee;
    }

    function payout(address zro, address to, uint256 amount, uint32 dstEid, bytes calldata options) external payable {
        if (msg.sender != vault) revert NotVault();
        if (_locked == 1) revert Reentered();
        _locked = 1;
        uint256 fee = quote(zro, to, amount, dstEid, options);
        if (msg.value < fee) revert FeeShort();
        IERC20(zro).safeTransferFrom(msg.sender, address(this), amount);
        (, OFTReceipt memory receipt) = IZroOft(zro).send{value: fee}(
            _param(to, amount, dstEid, options), MessagingFee({nativeFee: fee, lzTokenFee: 0}), to
        );
        if (receipt.amountSentLD < amount) IERC20(zro).safeTransfer(to, amount - receipt.amountSentLD);
        uint256 excess = msg.value - fee;
        if (excess > 0) {
            (bool ok,) = to.call{value: excess}("");
            if (!ok) revert RefundFailed();
        }
        _locked = 0;
    }

    function _param(address to, uint256 amount, uint32 dstEid, bytes calldata options)
        internal
        pure
        returns (SendParam memory)
    {
        return SendParam({
            dstEid: dstEid,
            to: bytes32(uint256(uint160(to))),
            amountLD: amount,
            minAmountLD: 0,
            extraOptions: options,
            composeMsg: "",
            oftCmd: ""
        });
    }
}
