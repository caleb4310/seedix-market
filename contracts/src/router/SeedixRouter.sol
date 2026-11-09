// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal v4 router. Exact-in uses a negative amountSpecified. Exact-out uses a positive one.
///         `limitAmount` is amountOutMin for exact-in and amountInMax for exact-out.
///         A zero price limit is rejected. The payer must approve this contract.
contract SeedixRouter is IUnlockCallback {
    using CurrencyLibrary for Currency;
    using SafeERC20 for IERC20;

    error NotPoolManager();
    error Expired();
    error PriceLimit();
    error TooLittleReceived();
    error TooMuchRequested();

    IPoolManager public immutable poolManager;

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
    }

    function swap(
        PoolKey calldata key,
        bool zeroForOne,
        int256 amountSpecified,
        uint256 limitAmount,
        uint256 deadline,
        uint160 sqrtPriceLimitX96
    ) external returns (BalanceDelta delta) {
        if (block.timestamp > deadline) revert Expired();
        if (sqrtPriceLimitX96 == 0) revert PriceLimit();
        if (zeroForOne) {
            if (sqrtPriceLimitX96 <= TickMath.MIN_SQRT_PRICE) revert PriceLimit();
        } else if (sqrtPriceLimitX96 >= TickMath.MAX_SQRT_PRICE) {
            revert PriceLimit();
        }

        bytes memory res = poolManager.unlock(
            abi.encode(msg.sender, key, zeroForOne, amountSpecified, sqrtPriceLimitX96, limitAmount)
        );
        delta = abi.decode(res, (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (
            address payer,
            PoolKey memory key,
            bool zeroForOne,
            int256 amountSpecified,
            uint160 limit,
            uint256 limitAmount
        ) = abi.decode(data, (address, PoolKey, bool, int256, uint160, uint256));
        BalanceDelta delta = poolManager.swap(
            key, SwapParams({zeroForOne: zeroForOne, amountSpecified: amountSpecified, sqrtPriceLimitX96: limit}), ""
        );
        _checkLimit(zeroForOne, amountSpecified, delta, limitAmount);
        _settle(key.currency0, delta.amount0(), payer);
        _settle(key.currency1, delta.amount1(), payer);
        return abi.encode(delta);
    }

    function _checkLimit(bool zeroForOne, int256 amountSpecified, BalanceDelta delta, uint256 limitAmount)
        internal
        pure
    {
        if (amountSpecified < 0) {
            int128 out = zeroForOne ? delta.amount1() : delta.amount0();
            if (out < 0 || uint256(uint128(out)) < limitAmount) revert TooLittleReceived();
        } else {
            int128 inp = zeroForOne ? delta.amount0() : delta.amount1();
            if (inp > 0 || uint256(uint128(-inp)) > limitAmount) revert TooMuchRequested();
        }
    }

    function _settle(Currency c, int128 amt, address payer) internal {
        if (amt < 0) {
            poolManager.sync(c);
            IERC20(Currency.unwrap(c)).safeTransferFrom(payer, address(poolManager), uint256(uint128(-amt)));
            poolManager.settle();
        } else if (amt > 0) {
            poolManager.take(c, payer, uint256(uint128(amt)));
        }
    }
}
