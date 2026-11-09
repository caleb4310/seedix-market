// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {SeedixRouter} from "../../../src/router/SeedixRouter.sol";
import {LaunchHook} from "../../../src/hook/LaunchHook.sol";
import {MockXStock} from "../../../src/token/MockXStock.sol";

/// @notice Invariant actor. Extend the virtual hook to record extra ghost variables.
///         The fuzzer calls the public entry points. Reverts are discarded by the test
///         (`fail_on_revert = false`) so a failed trade does not hide a later solvency break.
contract FeeHandler {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    SeedixRouter public immutable router;
    LaunchHook public immutable hook;
    MockXStock public immutable pair;
    address public immutable coin;
    PoolId public immutable poolId;

    uint256 public buys;
    uint256 public sells;

    constructor(SeedixRouter router_, LaunchHook hook_, MockXStock pair_, address coin_, PoolId poolId_) {
        router = router_;
        hook = hook_;
        pair = pair_;
        coin = coin_;
        poolId = poolId_;
        pair_.approve(address(router_), type(uint256).max);
    }

    function buyExactIn(uint256 amount) external {
        amount = _bound(amount, 1e15, 25 ether);
        _buy(amount);
        buys += 1;
        _afterAction();
    }

    function sellExactIn(uint256 amount) external {
        uint256 bal = pairBalance(coin);
        if (bal < 2) return;
        amount = _bound(amount, 1, bal / 2);
        _approveCoin();
        _sell(amount);
        sells += 1;
        _afterAction();
    }

    function buyExactOut(uint256 amount) external {
        amount = _bound(amount, 1e15, 1_000_000 ether);
        (,, bool coinIsToken0,,,,) = hook.config(poolId);
        _trade(!coinIsToken0, int256(amount));
        buys += 1;
        _afterAction();
    }

    function sellExactOut(uint256 amount) external {
        amount = _bound(amount, 1e12, 2 ether);
        (,, bool coinIsToken0,,,,) = hook.config(poolId);
        _approveCoin();
        _trade(coinIsToken0, int256(amount));
        sells += 1;
        _afterAction();
    }

    function warp(uint256 secs) external {
        uint256 dt = _bound(secs, 1, 40);
        vm.warp(vm.getBlockTimestamp() + dt);
        _afterAction();
    }

    function _afterAction() internal virtual {}

    function _buy(uint256 amount) internal {
        (,, bool coinIsToken0,,,,) = hook.config(poolId);
        _trade(!coinIsToken0, -int256(amount));
    }

    function _sell(uint256 amount) internal {
        (,, bool coinIsToken0,,,,) = hook.config(poolId);
        _trade(coinIsToken0, -int256(amount));
    }

    function _trade(bool zeroForOne, int256 amountSpecified) internal {
        uint256 limitAmount = amountSpecified < 0 ? 0 : type(uint128).max;
        uint160 price = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        router.swap(hook.keyOf(poolId), zeroForOne, amountSpecified, limitAmount, vm.getBlockTimestamp(), price);
    }

    function _approveCoin() internal {
        (bool ok,) = coin.call(abi.encodeWithSignature("approve(address,uint256)", address(router), type(uint256).max));
        ok;
    }

    function pairBalance(address token) internal view returns (uint256 bal) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (ok && data.length >= 32) bal = abi.decode(data, (uint256));
    }

    function _bound(uint256 x, uint256 lo, uint256 hi) internal pure returns (uint256) {
        if (hi <= lo) return lo;
        return lo + (x % (hi - lo));
    }
}
