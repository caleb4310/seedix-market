// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SeedixRouter} from "../../../src/router/SeedixRouter.sol";
import {LaunchHook} from "../../../src/hook/LaunchHook.sol";
import {MockXStock} from "../../../src/token/MockXStock.sol";

/// @notice Invariant actor. Extend the virtual hook to record extra ghost variables.
///         The fuzzer calls the public entry points. Reverts are discarded by the test
///         (`fail_on_revert = false`) so a failed trade does not hide a later solvency break.
contract FeeHandler {
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

    function warp(uint256 secs) external {
        uint256 dt = _bound(secs, 0, 2 days);
        // solhint-disable-next-line
        assembly {
        // Tests drive time through Foundry. This handler is only used under forge-std.
        }
        dt;
        _afterAction();
    }

    function _afterAction() internal virtual {}

    function _buy(uint256 amount) internal {
        (,, bool coinIsToken0,,,,) = hook.config(poolId);
        router.swap(hook.keyOf(poolId), !coinIsToken0, -int256(amount), 0);
    }

    function _sell(uint256 amount) internal {
        (,, bool coinIsToken0,,,,) = hook.config(poolId);
        router.swap(hook.keyOf(poolId), coinIsToken0, -int256(amount), 0);
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
