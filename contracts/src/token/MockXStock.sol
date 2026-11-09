// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Testnet stand-in for a bridged xStock, WHYPE, or USDC.
///         18 decimals for xStocks. The issuer can pause transfers and set a display multiplier.
contract MockXStock is ERC20, Ownable, Pausable {
    error BadMultiplier();

    uint8 private immutable _decimals;
    /// @notice Display multiplier, 1e18 = 1. Not a rebase. The UI multiplies the share price by this.
    uint256 public multiplier = 1e18;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address issuer)
        ERC20(name_, symbol_)
        Ownable(issuer)
    {
        _decimals = decimals_;
        _mint(issuer, 1_000_000_000 * 10 ** uint256(decimals_));
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function setMultiplier(uint256 next) external onlyOwner {
        if (next == 0) revert BadMultiplier();
        multiplier = next;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override whenNotPaused {
        super._update(from, to, value);
    }
}
