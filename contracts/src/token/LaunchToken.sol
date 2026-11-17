// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {SeedixConstants as C} from "../libraries/SeedixConstants.sol";

interface IZroWeight {
    function onTransfer(address from, address to, uint256 amount) external;
}

/// @notice Fixed-supply ERC-20. Cloned per coin and initialised once in the launch transaction.
///         `burn` reduces `totalSupply`. Sending tokens to the dead address does not.
contract LaunchToken {
    error AlreadyInitialized();
    error BadSupply();
    error InsufficientBalance();
    error InsufficientAllowance();
    error ZeroAddress();
    error NotifyLocked();

    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @notice Receives the launch team allocation. Always excluded from Kickback, even if allowlisted.
    address public teamWallet;

    bool private _initialized;
    /// @notice Set from the launcher when ZRO weights are wired. Unset coins transfer as before.
    address public weightTracker;
    uint256 private _inNotify;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    /// @dev Locks the implementation. Clones do not run this constructor.
    constructor() {
        _initialized = true;
    }

    function initialize(
        string calldata name_,
        string calldata symbol_,
        address liquidityTo,
        uint256 liquidityAmt,
        address teamTo,
        uint256 teamAmt
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (liquidityTo == address(0)) revert ZeroAddress();
        if (liquidityAmt + teamAmt != C.SUPPLY) revert BadSupply();
        if (teamAmt > 0 && teamTo == address(0)) revert ZeroAddress();
        _initialized = true;
        name = name_;
        symbol = symbol_;
        teamWallet = teamTo;
        weightTracker = _readTracker(msg.sender);
        _mint(liquidityTo, liquidityAmt);
        if (teamAmt > 0) _mint(teamTo, teamAmt);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    /// @notice Burns `amount` from the caller and reduces total supply.
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function _mint(address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
        _notify(address(0), to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        if (amount == 0) revert BadSupply();
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();
        balanceOf[from] = bal - amount;
        totalSupply -= amount;
        emit Transfer(from, address(0), amount);
        _notify(from, address(0), amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();
        balanceOf[from] = bal - amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        _notify(from, to, amount);
    }

    function _notify(address from, address to, uint256 amount) internal {
        if (weightTracker == address(0) || from == to || amount == 0) return;
        if (_inNotify == 1) revert NotifyLocked();
        _inNotify = 1;
        IZroWeight(weightTracker).onTransfer(from, to, amount);
        _inNotify = 0;
    }

    function _readTracker(address launcher) internal view returns (address tracker) {
        (bool ok, bytes memory data) = launcher.staticcall(abi.encodeWithSignature("zroWeightTracker()"));
        if (!ok || data.length < 32) return address(0);
        return abi.decode(data, (address));
    }
}
