// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {
    MessagingFee,
    MessagingParams,
    MessagingReceipt,
    Origin
} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";

interface ITestReceiver {
    function lzReceive(
        Origin calldata origin,
        bytes32 guid,
        bytes calldata message,
        address executor,
        bytes calldata extra
    ) external payable;
}

/// @notice Local stand-in for EndpointV2. `quote` returns `nativeFee`. `send` keeps that fee and
///         refunds any extra to the refund address. `deliverLast` plays the recorded message to the peer.
contract TestLzEndpoint {
    uint32 public immutable localEid;
    uint256 public nativeFee;

    address public lastSender;
    bytes32 public lastReceiver;
    bytes public lastMessage;
    bytes32 public lastGuid;
    uint64 public nonce;

    constructor(uint32 localEid_, uint256 nativeFee_) {
        localEid = localEid_;
        nativeFee = nativeFee_;
    }

    function setDelegate(address) external {}

    function lzToken() external pure returns (address) {
        return address(0);
    }

    function quote(MessagingParams calldata, address) external view returns (MessagingFee memory) {
        return MessagingFee({nativeFee: nativeFee, lzTokenFee: 0});
    }

    function send(MessagingParams calldata params, address refundAddress)
        external
        payable
        returns (MessagingReceipt memory)
    {
        require(msg.value >= nativeFee, "endpoint fee");
        nonce += 1;
        lastSender = msg.sender;
        lastReceiver = params.receiver;
        lastMessage = params.message;
        lastGuid = keccak256(abi.encode(params.dstEid, msg.sender, nonce, params.message));
        uint256 extra = msg.value - nativeFee;
        if (extra > 0) {
            (bool ok,) = refundAddress.call{value: extra}("");
            require(ok, "endpoint refund");
        }
        return
            MessagingReceipt({guid: lastGuid, nonce: nonce, fee: MessagingFee({nativeFee: nativeFee, lzTokenFee: 0})});
    }

    function deliverLast() external {
        address dst = address(uint160(uint256(lastReceiver)));
        ITestReceiver(dst)
            .lzReceive(
                Origin({srcEid: localEid, sender: bytes32(uint256(uint160(lastSender))), nonce: nonce}),
                lastGuid,
                lastMessage,
                address(this),
                ""
            );
    }
}
