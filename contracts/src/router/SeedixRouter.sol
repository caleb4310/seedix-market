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

/// @notice Minimal v4 router. Exact-in uses a negative amountSpecified. Exact-out uses a positive one.
///         A zero price limit means "no limit". The payer must approve this contract.
contract SeedixRouter is IUnlockCallback {
    using CurrencyLibrary for Currency;

    error NotPoolManager();
    error NotSelf();

    IPoolManager public immutable poolManager;

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
    }

    function swap(PoolKey calldata key, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96)
        external
        returns (BalanceDelta delta)
    {
        if (sqrtPriceLimitX96 == 0) {
            sqrtPriceLimitX96 = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        }
        bytes memory res =
            poolManager.unlock(abi.encode(msg.sender, key, zeroForOne, amountSpecified, sqrtPriceLimitX96));
        delta = abi.decode(res, (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (address payer, PoolKey memory key, bool zeroForOne, int256 amountSpecified, uint160 limit) =
            abi.decode(data, (address, PoolKey, bool, int256, uint160));
        BalanceDelta delta = poolManager.swap(
            key, SwapParams({zeroForOne: zeroForOne, amountSpecified: amountSpecified, sqrtPriceLimitX96: limit}), ""
        );
        _settle(key.currency0, delta.amount0(), payer);
        _settle(key.currency1, delta.amount1(), payer);
        return abi.encode(delta);
    }

    function _settle(Currency c, int128 amt, address payer) internal {
        if (amt < 0) {
            poolManager.sync(c);
            IERC20(Currency.unwrap(c)).transferFrom(payer, address(poolManager), uint256(uint128(-amt)));
            poolManager.settle();
        } else if (amt > 0) {
            poolManager.take(c, payer, uint256(uint128(amt)));
        }
    }
}
