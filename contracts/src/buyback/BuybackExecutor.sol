// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SeedixRoles} from "../access/SeedixRoles.sol";
import {SeedixConstants as C} from "../libraries/SeedixConstants.sol";
import {TwapGuard} from "../libraries/TwapGuard.sol";
import {LaunchHook} from "../hook/LaunchHook.sol";
import {LaunchToken} from "../token/LaunchToken.sol";

/// @notice Guarded buybacks. The swap itself is deferred until the executor is wired to a router.
///         Guards run first: pause, pool age, 30-minute oracle coverage, 2% spot band, TWAP min-out.
///         The xStock to WHYPE leg uses the same guards and reverts if that route is not a pool we can read.
contract BuybackExecutor {
    using SafeERC20 for IERC20;
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
    error AboveCap();
    error NotLocker();
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
    address public locker;
    address public immutable initializer;
    Currency public immutable whype;

    bool public buybacksPaused;
    bool public platformSet;
    address public platformToken;
    PoolId public platformPoolId;
    mapping(Currency => Route) public whypeRoute;
    mapping(PoolId => uint256) public lastBuybackAt;
    mapping(PoolId => uint256) public periodStart;
    mapping(PoolId => uint256) public spentInPeriod;
    mapping(Currency => uint256) public collected;
    uint256 public maxInPerPeriod = 50_000 ether;

    constructor(SeedixRoles roles_, Currency whype_, address initializer_) {
        if (initializer_ == address(0)) revert NotInitializer();
        roles = roles_;
        whype = whype_;
        initializer = initializer_;
    }

    function wire(LaunchHook hook_, address launcher_, address locker_) external {
        if (msg.sender != initializer || address(hook) != address(0)) revert NotInitializer();
        if (launcher_ == address(0) || locker_ == address(0)) revert NotInitializer();
        hook = hook_;
        launcher = launcher_;
        locker = locker_;
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

    /// @dev Guardian can only tighten the per-call cap. Raising it goes through the timelock.
    function setMaxInPerPeriod(uint256 next) external {
        if (msg.sender == roles.guardian()) {
            if (next == 0 || next >= maxInPerPeriod) revert AboveCap();
        } else if (msg.sender != address(roles.timelock())) {
            revert NotTimelock();
        }
        if (next == 0) revert AboveCap();
        maxInPerPeriod = next;
    }

    /// @dev The locker records the exact amount it just paid this contract for the platform pool.
    function noteCollected(Currency token, uint256 amount) external {
        if (msg.sender != locker) revert NotLocker();
        if (!platformSet || amount == 0) revert Nothing();
        collected[token] += amount;
    }

    /// @notice Move the recorded platform-pool balance into that pool's burn pots. The caller cannot pick a pool.
    function sweepCollected() external {
        if (!platformSet) revert PlatformNotSet();
        (address coin, Currency pair,,,,,) = hook.config(platformPoolId);
        _flush(Currency.wrap(coin));
        _flush(pair);
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

    /// @notice Reserves the period cap, then returns the floor. The swap itself is still unwired.
    ///         The reservation persists, so a later revert cannot reset the cap.
    function buybackCoin(PoolId id, uint256 amountIn, uint256 minOut) external returns (uint256 effective) {
        uint256 floor = _guard(id, amountIn, _inputIsCurrency0(id, _pairOf(id)));
        _consume(id, amountIn);
        effective = TwapGuard.effectiveMin(floor, minOut);
    }

    /// @notice WHYPE pairs guard the platform pool. Stock pairs sell the stock for WHYPE first.
    ///         The second leg's floor is quoted in WHYPE, using the first leg's floor as its input.
    function quotePlatform(Currency pair, uint256 amountIn, uint256 minWhypeOut, uint256 minPlatformOut)
        public
        view
        returns (uint256 whypeFloor, uint256 platformFloor)
    {
        if (!platformSet) revert PlatformNotSet();
        if (amountIn > maxInPerPeriod) revert AboveCap();
        if (minWhypeOut == 0 || minPlatformOut == 0) revert MinOutRequired();
        uint256 platformIn = amountIn;
        if (Currency.unwrap(pair) != Currency.unwrap(whype)) {
            Route memory route = whypeRoute[pair];
            if (!route.set) revert RouteNotRegistered();
            whypeFloor = TwapGuard.effectiveMin(
                _guard(route.poolId, amountIn, _inputIsCurrency0(route.poolId, pair)), minWhypeOut
            );
            platformIn = whypeFloor;
        }
        platformFloor = TwapGuard.effectiveMin(
            _guard(platformPoolId, platformIn, _inputIsCurrency0(platformPoolId, whype)), minPlatformOut
        );
    }

    function buybackPlatform(Currency pair, uint256 amountIn, uint256 minWhypeOut, uint256 minPlatformOut)
        external
        returns (uint256 whypeFloor, uint256 platformFloor)
    {
        (whypeFloor, platformFloor) = quotePlatform(pair, amountIn, minWhypeOut, minPlatformOut);
        if (Currency.unwrap(pair) != Currency.unwrap(whype)) {
            _consume(whypeRoute[pair].poolId, amountIn);
            _consume(platformPoolId, whypeFloor);
        } else {
            _consume(platformPoolId, amountIn);
        }
    }

    function _guard(PoolId id, uint256 amountIn, bool zeroForOne) internal view returns (uint256 floor) {
        if (buybacksPaused) revert BuybackIsPaused();
        if (amountIn == 0) revert Nothing();
        (,,,,, uint40 launchTime,) = hook.config(id);
        if (launchTime == 0) revert UnknownPool();
        if (block.timestamp < uint256(launchTime) + C.TWAP_WINDOW) revert YoungPool();
        (int24 twap, int24 spot) = hook.consult(id, C.TWAP_WINDOW);
        TwapGuard.assertBand(spot, twap);
        floor = TwapGuard.minOut(amountIn, twap, zeroForOne);
    }

    function _pairOf(PoolId id) internal view returns (Currency pair) {
        (, pair,,,,,) = hook.config(id);
    }

    /// @dev zeroForOne when `input` is currency0 of the pool.
    function _inputIsCurrency0(PoolId id, Currency input) internal view returns (bool) {
        (address coin, Currency other, bool coinIsToken0,,,,) = hook.config(id);
        Currency c0 = coinIsToken0 ? Currency.wrap(coin) : other;
        Currency c1 = coinIsToken0 ? other : Currency.wrap(coin);
        if (Currency.unwrap(input) != Currency.unwrap(c0) && Currency.unwrap(input) != Currency.unwrap(c1)) {
            revert BadRoute();
        }
        return Currency.unwrap(input) == Currency.unwrap(c0);
    }

    /// @dev Rolling window. A new period starts after `BUYBACK_INTERVAL`. The spent sum survives the call.
    function _consume(PoolId id, uint256 amountIn) internal {
        if (amountIn == 0) revert Nothing();
        if (amountIn > maxInPerPeriod) revert AboveCap();
        uint256 start = periodStart[id];
        if (start == 0 || block.timestamp >= start + C.BUYBACK_INTERVAL) {
            periodStart[id] = block.timestamp;
            spentInPeriod[id] = 0;
        }
        if (spentInPeriod[id] + amountIn > maxInPerPeriod) revert AboveCap();
        spentInPeriod[id] += amountIn;
        lastBuybackAt[id] = block.timestamp;
    }

    function _flush(Currency token) internal {
        uint256 amount = collected[token];
        if (amount == 0) return;
        collected[token] = 0;
        IERC20(Currency.unwrap(token)).forceApprove(address(hook), amount);
        hook.depositCollected(platformPoolId, token, amount);
    }
}
