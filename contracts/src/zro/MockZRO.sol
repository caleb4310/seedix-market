// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OFT} from "@layerzerolabs/oft-evm/contracts/OFT.sol";

/// @notice Testnet ZRO. Real ZRO is not deployed on testnets. This is the standard LayerZero OFT from
///         oft-evm 4.0.1 so a later phase can setPeer and send without a new token.
///         The owner and the LayerZero delegate are constructor arguments. They are the multisig, not a
///         hardcoded EOA. `mint` exists only so a testnet pool can be seeded.
contract MockZRO is OFT {
    constructor(address endpoint, address delegate) OFT("Mock ZRO", "ZRO", endpoint, delegate) Ownable(delegate) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
