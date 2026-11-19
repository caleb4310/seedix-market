// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";

/// @notice Writes Safe Transaction Builder JSON. The Safe UI turns the list into one MultiSend.
///         These scripts do not broadcast and do not read a private key.
abstract contract SafeBatch is Script {
    function _writeBatch(
        string memory path,
        uint256 chainId,
        string memory name,
        address[] memory to,
        bytes[] memory data
    ) internal {
        if (to.length != data.length || to.length == 0) revert("batch");
        string memory json = string.concat(
            '{"version":"1.0","chainId":"', vm.toString(chainId), '","meta":{"name":"', name, '"},"transactions":['
        );
        for (uint256 i; i < to.length; ++i) {
            if (i > 0) json = string.concat(json, ",");
            json = string.concat(
                json, '{"to":"', vm.toString(to[i]), '","value":"0","data":"', vm.toString(data[i]), '"}'
            );
        }
        json = string.concat(json, "]}");
        vm.writeFile(path, json);
        console2.log("safe batch", path);
        console2.log("txs", to.length);
    }
}
