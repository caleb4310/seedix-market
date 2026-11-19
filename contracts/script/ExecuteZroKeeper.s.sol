// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {ZroTaxSwapper} from "../src/zro/ZroTaxSwapper.sol";

/// @notice Executes the `setKeeper` operation that `DeployBaseSepoliaZro` or `DeployZro` scheduled.
///         Run it after the timelock delay, from the proposer. The salt matches the deploy scripts.
///         PRIVATE_KEY is never logged. This is a separate broadcast from the deploy.
contract ExecuteZroKeeper is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        TimelockController timelock = TimelockController(payable(vm.envAddress("ZRO_TIMELOCK")));
        address swapper = vm.envAddress("SWAPPER");
        address keeper = vm.envAddress("KEEPER");
        bytes memory data = abi.encodeCall(ZroTaxSwapper.setKeeper, (keeper));
        vm.startBroadcast(pk);
        timelock.execute(swapper, 0, data, bytes32(0), keccak256("zro-keeper"));
        vm.stopBroadcast();
        console2.log("keeper", keeper);
        console2.log("swapper", swapper);
    }
}
