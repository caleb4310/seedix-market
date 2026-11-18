// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LaunchHook} from "../src/hook/LaunchHook.sol";
import {SeedixRouter} from "../src/router/SeedixRouter.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";

interface IWETH {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @notice Tiny WETH buy then sell on the smoke pool. Local-only. PRIVATE_KEY is never logged.
contract SmokeSwap is Script {
    using PoolIdLibrary for PoolKey;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address hookAddr = vm.envAddress("HOOK_ADDRESS");
        address routerAddr = vm.envAddress("ROUTER_ADDRESS");
        address weth = vm.envAddress("WETH");
        address coin = vm.envAddress("COIN");
        uint256 buyWei = vm.envOr("BUY_WEI", uint256(0.00005 ether));
        address trader = vm.addr(pk);

        bool coinIsToken0 = uint160(coin) < uint160(weth);
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(coinIsToken0 ? coin : weth),
            currency1: Currency.wrap(coinIsToken0 ? weth : coin),
            fee: C.LP_FEE,
            tickSpacing: C.TICK_SPACING,
            hooks: IHooks(hookAddr)
        });
        PoolId id = key.toId();
        LaunchHook hook = LaunchHook(hookAddr);
        SeedixRouter router = SeedixRouter(routerAddr);

        uint128 holderBefore = hook.zroHolderPot(id);
        uint128 protocolBefore = hook.zroProtocolPot(id);

        vm.startBroadcast(pk);
        IWETH(weth).deposit{value: buyWei}();
        IERC20(weth).approve(routerAddr, type(uint256).max);
        IERC20(coin).approve(routerAddr, type(uint256).max);

        bool buyZeroForOne = !coinIsToken0; // WETH -> coin
        uint160 buyLimit = buyZeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        router.swap(key, buyZeroForOne, -int256(buyWei), 0, block.timestamp + 15 minutes, buyLimit);

        uint256 coinBal = IERC20(coin).balanceOf(trader);
        require(coinBal > 0, "no coin bought");
        uint256 sellAmt = coinBal / 2;
        if (sellAmt == 0) sellAmt = coinBal;
        bool sellZeroForOne = coinIsToken0; // coin -> WETH
        uint160 sellLimit = sellZeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        router.swap(key, sellZeroForOne, -int256(sellAmt), 0, block.timestamp + 15 minutes, sellLimit);
        vm.stopBroadcast();

        uint128 holderAfter = hook.zroHolderPot(id);
        uint128 protocolAfter = hook.zroProtocolPot(id);
        (bool enabled, uint16 creatorBps, uint16 protocolBps, uint8 mode, uint16 effectiveBps) = hook.zroTax(id);
        uint64 epoch = uint64(block.timestamp / 3600);
        console2.log("coin", coin);
        console2.log("coinIsToken0", coinIsToken0 ? 1 : 0);
        console2.log("buyWei", buyWei);
        console2.log("coinBoughtThenHeld", IERC20(coin).balanceOf(trader));
        console2.log("sold", sellAmt);
        console2.log("holderPotBefore", holderBefore);
        console2.log("protocolPotBefore", protocolBefore);
        console2.log("holderPotAfter", holderAfter);
        console2.log("protocolPotAfter", protocolAfter);
        console2.log("holderEpoch", hook.zroHolderEpoch(id, epoch));
        console2.log("protocolEpoch", hook.zroProtocolEpoch(id, epoch));
        console2.log("taxEnabled", enabled ? 1 : 0);
        console2.log("creatorBps", creatorBps);
        console2.log("protocolBps", protocolBps);
        console2.log("feeMode", mode);
        console2.log("effectiveBps", effectiveBps);
        console2.log("epoch", epoch);
        console2.log("poolId");
        console2.logBytes32(PoolId.unwrap(id));
    }
}
