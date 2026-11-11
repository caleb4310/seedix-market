// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SeedixRoles} from "../access/SeedixRoles.sol";
import {SeedixConstants as C} from "../libraries/SeedixConstants.sol";
import {TwapGuard} from "../libraries/TwapGuard.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {ProtocolFeeLibrary} from "@uniswap/v4-core/src/libraries/ProtocolFeeLibrary.sol";
import {OracleLib} from "../libraries/OracleLib.sol";
import {RouteDepth} from "../libraries/RouteDepth.sol";
import {LaunchHook} from "../hook/LaunchHook.sol";
import {LaunchToken} from "../token/LaunchToken.sol";
import {KickbackDistributor} from "../kickback/KickbackDistributor.sol";

/// @notice Guarded buybacks. The executor calls the PoolManager itself so the hook fee exemption applies.
///         Guards run first: pause, pool age, 30-minute oracle coverage, 2% spot band, TWAP min-out.
///         The bought coin is burned in the same call. A fill below the TWAP floor reverts the debit.
contract BuybackExecutor is IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
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
    error NotKeeper();
    error NotAdmin();
    error TooSoon();
    error KeeperDelayTooShort(uint256 given, uint256 minimum);
    error ImmediateKeeperDisabled();
    error NoKeeperProposal();
    error ExceedsPot(uint256 pot);
    error NotPoolManager();
    error TooLittleReceived();
    error ShallowRoute();

    event BuybacksPausedSet(address indexed by);
    event BuybacksUnpaused();
    event PlatformTokenSet(PoolId indexed poolId, address indexed token);
    event RouteRegistered(address indexed pair, PoolId indexed poolId);
    event CoinSideBurned(PoolId indexed poolId, uint256 amount);
    event KeeperSet(address indexed previous, address indexed next);
    event KeeperProposed(address indexed next, uint256 eta);
    event KeeperApplied(address indexed previous, address indexed next);
    event BuybackReserved(PoolId indexed poolId, uint256 amountIn, uint256 floor);
    event BuybackExecuted(PoolId indexed poolId, uint256 amountIn, uint256 coinBurned);

    struct Route {
        PoolId poolId;
        Currency currency0;
        Currency currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
        bool hookOracle;
        bool set;
    }

    SeedixRoles public immutable roles;
    LaunchHook public hook;
    address public launcher;
    address public locker;
    address public keeper;
    /// @dev One-shot. Deploy burns this so the deployer cannot grant a keeper later.
    bool public initialKeeperUsed;
    /// @dev Zero on 99801 and 31337 when the constructor is passed 0. At least 48 hours on every other chain.
    uint256 public immutable keeperDelay;
    address public proposedKeeper;
    uint256 public keeperEta;
    bool public keeperProposalActive;
    uint256 public constant MAINNET_KEEPER_DELAY = 48 hours;
    address public immutable initializer;
    Currency public immutable whype;

    bool public buybacksPaused;
    bool public platformSet;
    address public platformToken;
    PoolId public platformPoolId;
    mapping(Currency => Route) public whypeRoute;
    mapping(address => OracleLib.State) internal routeOracle;
    /// @notice Minimum WHYPE in the active liquidity across one tick spacing.
    ///         Zero disables the check. Mainnet's documented default is 10_000 WHYPE.
    ///         Chain 99801 is set lower because the deployer cannot seed that much.
    uint256 public minRouteDepth;
    bool public routesBootstrapped;
    mapping(PoolId => uint256) public lastBuybackAt;
    mapping(PoolId => uint256) public periodStart;
    mapping(PoolId => uint256) public spentInPeriod;
    mapping(Currency => uint256) public collected;
    uint256 public maxInPerPeriod = 50_000 ether;

    constructor(
        SeedixRoles roles_,
        Currency whype_,
        address initializer_,
        uint256 minRouteDepth_,
        uint256 keeperDelay_
    ) {
        if (initializer_ == address(0)) revert NotInitializer();
        if (block.chainid != 99801 && block.chainid != 31337 && keeperDelay_ < MAINNET_KEEPER_DELAY) {
            revert KeeperDelayTooShort(keeperDelay_, MAINNET_KEEPER_DELAY);
        }
        roles = roles_;
        whype = whype_;
        initializer = initializer_;
        minRouteDepth = minRouteDepth_;
        keeperDelay = keeperDelay_;
    }

    function wire(LaunchHook hook_, address launcher_, address locker_) external {
        if (msg.sender != initializer || address(hook) != address(0)) revert NotInitializer();
        if (launcher_ == address(0) || locker_ == address(0)) revert NotInitializer();
        hook = hook_;
        launcher = launcher_;
        locker = locker_;
    }

    /// @notice Immediate grant or revoke. Only when `keeperDelay` is zero (99801 and local Anvil).
    ///         The zero address revokes the keeper. On mainnet use `proposeKeeper` and `applyKeeper`.
    ///         The admin on mainnet is intended to be a multisig, distinct from the fee wallet.
    function setKeeper(address next) external {
        if (msg.sender != roles.admin()) revert NotAdmin();
        if (keeperDelay != 0) revert ImmediateKeeperDisabled();
        _setKeeper(next);
    }

    /// @notice Queue a keeper change. On a zero delay this applies immediately.
    ///         Otherwise it can be applied after `keeperDelay`, which is at least 48 hours off testnet.
    function proposeKeeper(address next) external {
        if (msg.sender != roles.admin()) revert NotAdmin();
        if (keeperDelay == 0) {
            _setKeeper(next);
            return;
        }
        proposedKeeper = next;
        keeperEta = block.timestamp + keeperDelay;
        keeperProposalActive = true;
        emit KeeperProposed(next, keeperEta);
    }

    /// @notice Apply the queued keeper. Anyone can call it once the delay has passed.
    function applyKeeper() external {
        if (!keeperProposalActive) revert NoKeeperProposal();
        if (block.timestamp < keeperEta) revert TooSoon();
        keeperProposalActive = false;
        address next = proposedKeeper;
        emit KeeperApplied(keeper, next);
        _setKeeper(next);
    }

    function _setKeeper(address next) internal {
        emit KeeperSet(keeper, next);
        keeper = next;
    }

    /// @notice Deploy-time grant. The initializer can call this once, including with the zero address,
    ///         which only burns the right. Later changes go through `setKeeper`.
    function grantKeeper(address next) external {
        if (msg.sender != initializer || initialKeeperUsed) revert NotInitializer();
        initialKeeperUsed = true;
        if (next == address(0)) return;
        emit KeeperSet(address(0), next);
        keeper = next;
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
        PoolKey memory key = hook.keyOf(id);
        _storeRoute(pair, key, true);
    }

    /// @notice Timelock registers a hookless pair/WHYPE pool. Later changes use this, not bootstrap.
    function registerExternal(PoolKey calldata key) external {
        if (msg.sender != address(roles.timelock())) revert NotTimelock();
        _registerExternal(key);
    }

    /// @notice Deploy-time routes. The initializer can call this once, including with an empty list,
    ///         which only burns the right.
    function bootstrapRoutes(PoolKey[] calldata keys) external {
        if (msg.sender != initializer || routesBootstrapped) revert NotInitializer();
        routesBootstrapped = true;
        uint256 n = keys.length;
        for (uint256 i; i < n; ++i) {
            _registerExternal(keys[i]);
        }
    }

    function setMinRouteDepth(uint256 next) external {
        if (msg.sender != address(roles.timelock())) revert NotTimelock();
        minRouteDepth = next;
    }

    function routeOk(Currency pair) external view returns (bool) {
        Route memory route = whypeRoute[pair];
        if (!route.set) return false;
        if (minRouteDepth == 0) return true;
        return _depth(route) + 1 >= minRouteDepth;
    }

    function routeDepth(Currency pair) external view returns (uint256) {
        Route memory route = whypeRoute[pair];
        if (!route.set) return 0;
        return _depth(route);
    }

    /// @notice Accrues the last observed tick across the gap, not the live tick.
    ///         A jump since the last poke then fails the spot band instead of rewriting the TWAP.
    function pokeRoute(address pair) public {
        Route memory route = whypeRoute[Currency.wrap(pair)];
        if (!route.set || route.hookOracle) return;
        OracleLib.State storage oracle = routeOracle[pair];
        if (oracle.count == 0) return;
        int24 remembered = oracle.obs[oracle.index].tick;
        OracleLib.onSwap(oracle, uint32(block.timestamp), remembered);
    }

    /// @notice Tokens above the recorded `collected` balance. A positive rebase or a stray transfer.
    ///         A shortfall is left in place. This does not repair pool reserves.
    function recoverToken(address token, address to) external {
        if (msg.sender != address(roles.timelock())) revert NotTimelock();
        if (to == address(0)) revert Nothing();
        uint256 beforeBal = IERC20(token).balanceOf(address(this));
        uint256 owed = collected[Currency.wrap(token)];
        if (beforeBal <= owed) revert Nothing();
        uint256 extra = beforeBal - owed;
        IERC20(token).safeTransfer(to, extra);
        if (IERC20(token).balanceOf(address(this)) + extra != beforeBal) revert TooLittleReceived();
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

    /// @notice Swaps accrued WHYPE fees into the backing token. A missing route or a price
    ///         outside the TWAP band reverts before the pot is touched, so the keeper retries.
    function convertAccrued(PoolId id) external returns (uint256 out) {
        if (msg.sender != keeper || keeper == address(0)) revert NotKeeper();
        address backing = hook.backingOf(id);
        if (backing == address(0)) revert Nothing();
        (,,, uint8 mode,,,) = hook.config(id);
        (uint128 creatorPair,, uint128 kickbackPair,,) = hook.pots(id);
        uint256 amount = mode == 0 ? uint256(creatorPair) : mode == 1 ? uint256(kickbackPair) : 0;
        if (amount == 0) revert Nothing();
        Currency token = Currency.wrap(backing);
        Route memory registered = whypeRoute[token];
        if (!registered.set) revert RouteNotRegistered();
        if (minRouteDepth != 0 && _depth(registered) + 1 < minRouteDepth) revert RouteNotRegistered();
        uint256 depth = _depth(registered);
        if (depth > 4 && amount > depth / 4) amount = depth / 4;
        pokeRoute(backing);
        Route memory route = whypeRoute[token];
        PoolKey memory key = _routeKey(route);
        (, int24 spot,,) = hook.poolManager().getSlot0(key.toId());
        int24 twap = OracleLib.consult(routeOracle[backing], uint32(block.timestamp), C.TWAP_WINDOW, spot);
        TwapGuard.assertBand(spot, twap);
        bool zeroForOne = Currency.unwrap(whype) == Currency.unwrap(key.currency0);
        uint256 floor = TwapGuard.minOut(amount, twap, zeroForOne);
        if (floor < 1) revert TooLittleReceived();
        if (mode == 0) hook.debitCreatorPair(id, amount, address(this));
        else hook.debitKickback(id, amount, address(this));
        out = _swapKey(key, whype, amount, floor);
        if (mode == 0) {
            (,,,,,, address recipient) = hook.config(id);
            IERC20(backing).safeTransfer(recipient, out);
        } else {
            address dist = hook.kickbackDistributor();
            IERC20(backing).safeTransfer(dist, out);
            KickbackDistributor(dist).noteBacking(id, out);
        }
        emit BuybackExecuted(id, amount, out);
    }

    /// @notice Buys the coin with the burn-pair pot and burns what it receives.
    ///         `effective` is the TWAP floor, raised to the caller's min-out when that is higher.
    function buybackCoin(PoolId id, uint256 amountIn, uint256 minOut) external returns (uint256 effective) {
        if (msg.sender != keeper || keeper == address(0)) revert NotKeeper();
        Currency pair = _pairOf(id);
        uint256 floor = _guard(id, amountIn, _inputIsCurrency0(id, pair));
        effective = TwapGuard.effectiveMin(floor, minOut);
        _consume(id, amountIn, _burnPair(id));
        hook.debitBurnPair(id, amountIn, address(this));
        uint256 burned = _swapAndBurn(id, pair, amountIn, effective);
        emit BuybackReserved(id, amountIn, effective);
        emit BuybackExecuted(id, amountIn, burned);
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
            whypeFloor = TwapGuard.effectiveMin(_routeFloor(pair, route, amountIn), minWhypeOut);
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
        if (msg.sender != keeper || keeper == address(0)) revert NotKeeper();
        if (Currency.unwrap(pair) != Currency.unwrap(whype)) pokeRoute(Currency.unwrap(pair));
        (whypeFloor, platformFloor) = quotePlatform(pair, amountIn, minWhypeOut, minPlatformOut);
        // Every platform buyback, including the stock leg, shares the platform pool's interval.
        // The route pool keeps its own coin-buyback slot.
        _consume(platformPoolId, amountIn, hook.platformBurn(pair));
        hook.debitPlatformBurn(pair, amountIn, address(this));
        uint256 whypeIn = amountIn;
        if (Currency.unwrap(pair) != Currency.unwrap(whype)) {
            Route memory route = whypeRoute[pair];
            whypeIn = _swapKey(_routeKey(route), pair, amountIn, whypeFloor);
        }
        uint256 burned = _swapAndBurn(platformPoolId, whype, whypeIn, platformFloor);
        emit BuybackReserved(platformPoolId, amountIn, platformFloor);
        emit BuybackExecuted(platformPoolId, whypeIn, burned);
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

    function _burnPair(PoolId id) internal view returns (uint256) {
        (,,, uint128 burnPair,) = hook.pots(id);
        return burnPair;
    }

    /// @dev One buyback per `BUYBACK_INTERVAL`, sized to the burn-pair pot and the per-call cap.
    ///      The next window opens only after the interval, so a boundary cannot reserve two caps.
    function _consume(PoolId id, uint256 amountIn, uint256 pot) internal {
        if (amountIn == 0) revert Nothing();
        if (lastBuybackAt[id] != 0 && block.timestamp < lastBuybackAt[id] + C.BUYBACK_INTERVAL) revert TooSoon();
        if (amountIn > pot) revert ExceedsPot(pot);
        if (amountIn > maxInPerPeriod) revert AboveCap();
        periodStart[id] = block.timestamp;
        spentInPeriod[id] = amountIn;
        lastBuybackAt[id] = block.timestamp;
    }

    /// @dev The PoolManager calls this while the executor is the locker. The hook then sees this contract as sender.
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        IPoolManager pm = hook.poolManager();
        if (msg.sender != address(pm)) revert NotPoolManager();
        (PoolKey memory key, bool zeroForOne, uint256 amountIn, uint256 minOut) =
            abi.decode(data, (PoolKey, bool, uint256, uint256));
        BalanceDelta delta = pm.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -_asInt(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        int128 received = zeroForOne ? delta.amount1() : delta.amount0();
        if (received <= 0 || uint256(uint128(received)) < minOut) revert TooLittleReceived();
        _settle(pm, key.currency0, delta.amount0());
        _settle(pm, key.currency1, delta.amount1());
        return abi.encode(uint256(uint128(received)));
    }

    function _swap(PoolId id, Currency input, uint256 amountIn, uint256 minOut) internal returns (uint256 out) {
        out = _swapKey(hook.keyOf(id), input, amountIn, minOut);
    }

    function _swapKey(PoolKey memory key, Currency input, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 out)
    {
        bool zeroForOne = Currency.unwrap(input) == Currency.unwrap(key.currency0);
        bytes memory res = hook.poolManager().unlock(abi.encode(key, zeroForOne, amountIn, minOut));
        out = abi.decode(res, (uint256));
    }

    function _storeRoute(Currency pair, PoolKey memory key, bool hookOracle) internal {
        if (minRouteDepth != 0 && _depthKey(key) + 1 < minRouteDepth) revert ShallowRoute();
        whypeRoute[pair] = Route({
            poolId: key.toId(),
            currency0: key.currency0,
            currency1: key.currency1,
            fee: key.fee,
            tickSpacing: key.tickSpacing,
            hooks: address(key.hooks),
            hookOracle: hookOracle,
            set: true
        });
        if (!hookOracle) {
            (, int24 tick,,) = hook.poolManager().getSlot0(key.toId());
            OracleLib.init(routeOracle[Currency.unwrap(pair)], uint32(block.timestamp), tick);
        }
        emit RouteRegistered(Currency.unwrap(pair), key.toId());
    }

    function _registerExternal(PoolKey calldata key) internal {
        bool whype0 = Currency.unwrap(key.currency0) == Currency.unwrap(whype);
        bool whype1 = Currency.unwrap(key.currency1) == Currency.unwrap(whype);
        if (whype0 == whype1) revert BadRoute();
        address pair = whype0 ? Currency.unwrap(key.currency1) : Currency.unwrap(key.currency0);
        (uint160 sqrtP,,,) = hook.poolManager().getSlot0(key.toId());
        if (sqrtP == 0) revert BadRoute();
        _storeRoute(Currency.wrap(pair), key, false);
    }

    function _routeKey(Route memory route) internal pure returns (PoolKey memory) {
        return PoolKey({
            currency0: route.currency0,
            currency1: route.currency1,
            fee: route.fee,
            tickSpacing: route.tickSpacing,
            hooks: IHooks(route.hooks)
        });
    }

    function _depth(Route memory route) internal view returns (uint256) {
        return _depthKey(_routeKey(route));
    }

    function _depthKey(PoolKey memory key) internal view returns (uint256) {
        return RouteDepth.whypeInNextSpacing(hook.poolManager(), key, whype);
    }

    /// @notice Reward-token units that match `hypeIn` wei of HYPE.
    ///         WHYPE is 1:1. Any other token uses the backing route's TWAP, 1% inside the quote,
    ///         and returns 0 when the route is missing or the spot is outside the band.
    function quoteReward(address token, uint256 hypeIn) external view returns (uint256 rewardOut) {
        if (hypeIn == 0 || token == Currency.unwrap(whype)) return hypeIn;
        try this.quoteRewardStrict(token, hypeIn) returns (uint256 out) {
            return out;
        } catch {
            return 0;
        }
    }

    /// @notice Reverts when the backing route cannot be priced. `quoteReward` turns that into 0.
    function quoteRewardStrict(address token, uint256 hypeIn) external view returns (uint256) {
        if (token == Currency.unwrap(whype)) return hypeIn;
        Route memory route = whypeRoute[Currency.wrap(token)];
        if (!route.set) revert RouteNotRegistered();
        if (buybacksPaused) revert BuybackIsPaused();
        if (hypeIn < 1) revert Nothing();
        PoolKey memory key = _routeKey(route);
        int24 spot = _routeSpot(key);
        int24 twap = OracleLib.consult(routeOracle[token], uint32(block.timestamp), C.TWAP_WINDOW, spot);
        TwapGuard.assertBand(spot, twap);
        bool zeroForOne = Currency.unwrap(whype) == Currency.unwrap(key.currency0);
        return TwapGuard.minOut(hypeIn, twap, zeroForOne);
    }

    /// @dev Every `getSlot0` word is checked. A zero sqrt price means the pool was never initialized.
    ///      The fee words have to be a valid static fee, the dynamic-fee flag, or a valid protocol fee.
    function _routeSpot(PoolKey memory key) internal view returns (int24 spot) {
        (uint160 sqrtPrice, int24 tick, uint24 protocolFee, uint24 lpFee) = hook.poolManager().getSlot0(key.toId());
        if (sqrtPrice < 1 || !_slotFeesOk(protocolFee, lpFee)) revert RouteNotRegistered();
        spot = tick;
    }

    function _slotFeesOk(uint24 protocolFee, uint24 lpFee) internal pure returns (bool) {
        if (!ProtocolFeeLibrary.isValidProtocolFee(protocolFee)) return false;
        if (lpFee > LPFeeLibrary.MAX_LP_FEE) {
            if (lpFee < LPFeeLibrary.DYNAMIC_FEE_FLAG || lpFee > LPFeeLibrary.DYNAMIC_FEE_FLAG) return false;
        }
        return true;
    }

    function _routeFloor(Currency pair, Route memory route, uint256 amountIn) internal view returns (uint256) {
        if (route.hookOracle) {
            return _guard(route.poolId, amountIn, _inputIsCurrency0(route.poolId, pair));
        }
        return _guardExternal(pair, route, amountIn);
    }

    function _guardExternal(Currency pair, Route memory route, uint256 amountIn) internal view returns (uint256 floor) {
        if (buybacksPaused) revert BuybackIsPaused();
        if (amountIn == 0) revert Nothing();
        address token = Currency.unwrap(pair);
        PoolKey memory key = _routeKey(route);
        (, int24 spot,,) = hook.poolManager().getSlot0(key.toId());
        int24 twap = OracleLib.consult(routeOracle[token], uint32(block.timestamp), C.TWAP_WINDOW, spot);
        TwapGuard.assertBand(spot, twap);
        bool zeroForOne = Currency.unwrap(pair) == Currency.unwrap(key.currency0);
        floor = TwapGuard.minOut(amountIn, twap, zeroForOne);
    }

    function _swapAndBurn(PoolId id, Currency input, uint256 amountIn, uint256 minOut)
        internal
        returns (uint256 burned)
    {
        burned = _swap(id, input, amountIn, minOut);
        (address coin,,,,,,) = hook.config(id);
        LaunchToken(coin).burn(burned);
    }

    function _settle(IPoolManager pm, Currency token, int128 amt) internal {
        if (amt < 0) {
            pm.sync(token);
            IERC20(Currency.unwrap(token)).safeTransfer(address(pm), uint256(uint128(-amt)));
            pm.settle();
        } else if (amt > 0) {
            pm.take(token, address(this), uint256(uint128(amt)));
        }
    }

    function _asInt(uint256 amount) internal pure returns (int256) {
        if (amount > uint256(type(int256).max)) revert Nothing();
        return int256(amount);
    }

    function _flush(Currency token) internal {
        uint256 amount = collected[token];
        if (amount == 0) return;
        collected[token] = 0;
        IERC20(Currency.unwrap(token)).forceApprove(address(hook), amount);
        hook.depositCollected(platformPoolId, token, amount);
    }
}
