// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {console2} from "forge-std/Script.sol";
import {IMessageLibManager} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";
import {SafeOps} from "../src/zro/SafeOps.sol";
import {UlnPolicy} from "../src/zro/UlnPolicy.sol";
import {SafeBatch} from "./SafeBatch.sol";

/// @notice Builds the Safe batch that sets the send and receive ULN config, then checks the
///         policy before writing it. Set VERIFY=1 after the Safe has executed to read `getConfig`
///         back and assert the same DVNs. This script does not broadcast.
///
///         ULN_CONFIG defaults to `config/uln/<chainId>.json`. That file lists every LayerZero Labs
///         DVN on the chain. LZ_ENDPOINT, LZ_SEND_LIB, LZ_RECEIVE_LIB, OAPP and REMOTE_EID come
///         from the environment. The file's chainId must match this chain.
contract SetUlnConfig is SafeBatch {
    error ChainMismatch(uint256 file, uint256 live);
    error ZeroLib();

    function run() external {
        uint256 chainId = vm.envOr("CHAIN_ID", block.chainid);
        string memory path = vm.envOr("ULN_CONFIG", string.concat("config/uln/", vm.toString(chainId), ".json"));
        string memory json = vm.readFile(path);
        uint256 fileChain = vm.parseJsonUint(json, ".chainId");
        if (fileChain != chainId) revert ChainMismatch(fileChain, chainId);
        address[] memory labs = vm.parseJsonAddressArray(json, ".lzLabsDvns");
        address[] memory dvns = vm.parseJsonAddressArray(json, ".requiredDvns");
        uint64 confirmations = uint64(vm.parseJsonUint(json, ".confirmations"));
        UlnPolicy.assertDvns(dvns, labs);
        bytes memory encoded = UlnPolicy.encode(confirmations, dvns);

        address endpoint = vm.envAddress("LZ_ENDPOINT");
        address sendLib = vm.envAddress("LZ_SEND_LIB");
        address receiveLib = vm.envAddress("LZ_RECEIVE_LIB");
        address oapp = vm.envAddress("OAPP");
        uint32 remoteEid = uint32(vm.envUint("REMOTE_EID"));
        if (endpoint == address(0) || sendLib == address(0) || receiveLib == address(0) || oapp == address(0)) {
            revert ZeroLib();
        }

        address[] memory to = new address[](2);
        bytes[] memory data = new bytes[](2);
        to[0] = endpoint;
        data[0] = SafeOps.ulnSetConfig(oapp, sendLib, remoteEid, encoded);
        to[1] = endpoint;
        data[1] = SafeOps.ulnSetConfig(oapp, receiveLib, remoteEid, encoded);
        _writeBatch(vm.envOr("SAFE_BATCH_OUT", string("out/safe/uln.json")), chainId, "set-uln", to, data);

        if (vm.envOr("VERIFY", false)) {
            UlnPolicy.assertEncoded(
                IMessageLibManager(endpoint).getConfig(oapp, sendLib, remoteEid, UlnPolicy.CONFIG_TYPE_ULN), dvns, labs
            );
            UlnPolicy.assertEncoded(
                IMessageLibManager(endpoint).getConfig(oapp, receiveLib, remoteEid, UlnPolicy.CONFIG_TYPE_ULN),
                dvns,
                labs
            );
            console2.log("uln verified");
        }
        console2.log("required dvns", dvns.length);
    }
}
