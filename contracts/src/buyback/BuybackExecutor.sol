// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SeedixRoles} from "../access/SeedixRoles.sol";
import {SeedixConstants as C} from "../libraries/SeedixConstants.sol";
import {TwapGuard} from "../libraries/TwapGuard.sol";
import {LaunchHook} from "../hook/LaunchHook.sol";
import {LaunchToken} from "../token/LaunchToken.sol";

/// @notice Guarded buybacks. The swap itself is deferred until the executor is wired to a router.
///         Guards run first: pause, pool age, 30-minute oracle coverage, 2% spot band, TWAP min-out.
///         The xStock to WHYPE leg uses the same guards and reverts if that route is not a pool we can read.
contract BuybackExecutor {
    error NotGuardian();
    error NotTimelock();
    error NotLauncher();
    error NotInitializer();
    error BuybackIsPaused();
    error YoungPool();
    error UnknownPool();
    error PlatformNotSet();
    error PlatformAlreadySet();
    error RouteNotRegistered();
    error BadRoute();
    error MinOutRequired();
    error Nothing();
    error BuybackSwapDeferred(uint256 minOutFloor);

    event BuybacksPausedSet(address indexed by);
    event BuybacksUnpaused();
    event PlatformTokenSet(PoolId indexed poolId, address indexed token);
    event RouteRegistered(address indexed pair, PoolId indexed poolId);
    event CoinSideBurned(PoolId indexed poolId, uint256 amount);

    struct Route {
        PoolId poolId;
        bool set;
    }

    SeedixRoles public immutable roles;
    LaunchHook public hook;
    address public launcher;
    address public immutable initializer;
    Currency public immutable whype;

    bool public buybacksPaused;
    bool public platformSet;
    address public platformToken;
    PoolId public platformPoolId;
    mapping(Currency => Route) public whypeRoute;
    mapping(PoolId => uint256) public lastBuybackAt;

    constructor(SeedixRoles roles_, Currency whype_, address initializer_) {
        if (initializer_ == address(0)) revert NotInitializer();
        roles = roles_;
        whype = whype_;
        initializer = initializer_;
    }

    function wire(LaunchHook hook_, address launcher_) external {
        if (msg.sender != initializer || address(hook) != address(0)) revert NotInitializer();
        hook = hook_;
        launcher = launcher_;
    }

    function setPlatform(PoolId id, address token) external {
        if (msg.sender != launcher) revert NotLauncher();
        if (platformSet || token == address(0)) revert PlatformAlreadySet();
        platformSet = true;
        platformToken = token;
        platformPoolId = id;
        emit PlatformTokenSet(id, token);
    }

    function pause() external {
        if (msg.sender != roles.guardian()) revert NotGuardian();
        buybacksPaused = true;
        emit BuybacksPausedSet(msg.sender);
    }

    function unpause() external {
        if (msg.sender != address(roles.timelock())) revert NotTimelock();
        buybacksPaused = false;
        emit BuybacksUnpaused();
    }

    /// @dev Register a Seedix pool whose currencies are exactly {stock, WHYPE}. Third-party pools
    ///      without our observations cannot be registered, so the leg fails closed.
    function registerRoute(Currency pair, PoolId id) external {
        if (msg.sender != address(roles.timelock())) revert NotTimelock();
        (address coin, Currency other,,,,,) = hook.config(id);
        bool matchWhype = coin == Currency.unwrap(whype) || Currency.unwrap(other) == Currency.unwrap(whype);
        bool matchPair = coin == Currency.unwrap(pair) || Currency.unwrap(other) == Currency.unwrap(pair);
        if (!matchWhype || !matchPair || Currency.unwrap(pair) == Currency.unwrap(whype)) revert BadRoute();
        whypeRoute[pair] = Route({poolId: id, set: true});
        emit RouteRegistered(Currency.unwrap(pair), id);
    }

    function burnCoinSide(PoolId id) external {
        if (buybacksPaused) revert BuybackIsPaused();
        (,,,, uint128 burnCoin) = hook.pots(id);
        if (burnCoin == 0) revert Nothing();
        (address coin,,,,,,) = hook.config(id);
        hook.debitBurnCoin(id, burnCoin, address(this));
        LaunchToken(coin).burn(burnCoin);
        emit CoinSideBurned(id, burnCoin);
    }

    /// @notice Runs the guards, then reverts with the contract-computed floor. The swap lands in a later milestone.
    function buybackCoin(PoolId id, uint256 amountIn, uint256 minOut) external view returns (uint256) {
        uint256 floor = _guard(id, amountIn, _zeroForOne(id, true));
        uint256 effective = TwapGuard.effectiveMin(floor, minOut);
        revert BuybackSwapDeferred(effective);
    }

    /// @notice WHYPE pairs guard the platform pool. Stock pairs also guard the xStock to WHYPE leg.
    function buybackPlatform(Currency pair, uint256 amountIn, uint256 minWhypeOut, uint256 minPlatformOut)
        external
        view
        returns (uint256 whypeFloor, uint256 platformFloor)
    {
        if (!platformSet) revert PlatformNotSet();
        if (minWhypeOut == 0 || minPlatformOut == 0) revert MinOutRequired();
        if (Currency.unwrap(pair) != Currency.unwrap(whype)) {
            Route memory route = whypeRoute[pair];
            if (!route.set) revert RouteNotRegistered();
            whypeFloor = TwapGuard.effectiveMin(_guard(route.poolId, amountIn, true), minWhypeOut);
        }
        platformFloor =
            TwapGuard.effectiveMin(_guard(platformPoolId, amountIn, _zeroForOne(platformPoolId, true)), minPlatformOut);
        revert BuybackSwapDeferred(platformFloor);
    }

    function _guard(PoolId id, uint256 amountIn, bool zeroForOne) internal view returns (uint256 floor) {
        if (buybacksPaused) revert BuybackIsPaused();
        if (amountIn == 0) revert Nothing();
        (,,,,, uint40 launchTime,) = hook.config(id);
        if (launchTime == 0) revert UnknownPool();
        if (block.timestamp < uint256(launchTime) + C.TWAP_WINDOW) revert YoungPool();
        if (block.timestamp < lastBuybackAt[id] + C.BUYBACK_INTERVAL && lastBuybackAt[id] != 0) revert YoungPool();
        (int24 twap, int24 spot) = hook.consult(id, C.TWAP_WINDOW);
        TwapGuard.assertBand(spot, twap);
        floor = TwapGuard.minOut(amountIn, twap, zeroForOne);
    }

    function _zeroForOne(PoolId id, bool pairIn) internal view returns (bool) {
        (, Currency pair, bool coinIsToken0,,,,) = hook.config(id);
        pair;
        // Pair in: zeroForOne when the pair is token0.
        if (pairIn) return !coinIsToken0;
        return coinIsToken0;
    }
}
