// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {SetConfigParam} from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/IMessageLibManager.sol";
import {UlnPolicy} from "./UlnPolicy.sol";

interface ISetConfig {
    function setConfig(address oapp, address lib, SetConfigParam[] calldata params) external;
}

/// @notice Calldata for Safe batches. One operation per chain. Nothing here broadcasts.
library SafeOps {
    function peerSchedule(address oft, uint32 remoteEid, address peer, bytes32 salt, uint256 delay)
        internal
        pure
        returns (bytes memory)
    {
        bytes memory inner =
            abi.encodeWithSignature("setPeer(uint32,bytes32)", remoteEid, bytes32(uint256(uint160(peer))));
        return abi.encodeCall(TimelockController.schedule, (oft, 0, inner, bytes32(0), salt, delay));
    }

    function ulnSetConfig(address oapp, address lib, uint32 remoteEid, bytes memory config)
        internal
        pure
        returns (bytes memory)
    {
        SetConfigParam[] memory params = new SetConfigParam[](1);
        params[0] = SetConfigParam({eid: remoteEid, configType: UlnPolicy.CONFIG_TYPE_ULN, config: config});
        return abi.encodeCall(ISetConfig.setConfig, (oapp, lib, params));
    }
}
