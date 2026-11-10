// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SeedixConstants as C} from "../libraries/SeedixConstants.sol";
import {SeedixRoles} from "../access/SeedixRoles.sol";

interface IHasRoles {
    function roles() external view returns (SeedixRoles);
}
import {FeeMath} from "../libraries/FeeMath.sol";
import {OracleLib} from "../libraries/OracleLib.sol";

/// @notice Ownerless fee hook. Pots are ERC-6909 claims. Spending them is a per-pot debit.
///         The cumulative accrues on every swap. Ring writes stay on a 30 second cadence.
contract LaunchHook is IHooks, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using StateLibrary for IPoolManager;
    using SafeERC20 for IERC20;

    error NotPoolManager();
    error NotLauncher();
    error NotVault();
    error NotDistributor();
    error NotExecutor();
    error NotInitializer();
    error NotLocker();
    error Locked();
    error NotInitiator();
    error UnknownPool();
    error BadKey();
    error StageMissing();
    error StageOccupied();
    error PoolExists();
    error SwapDuringLaunch();
    error Amount();
    error Overflow();
    error FeeTooLarge();
    error NotTimelock();

    uint8 internal constant ACTION_PAY = 1;
    uint8 internal constant ACTION_PULL = 2;
    uint256 internal constant LOCK_SWAP = 1;
    uint256 internal constant LOCK_MOVE = 2;
    uint256 internal constant META_EXEMPT = 1;
    uint256 internal constant META_BUY = 2;
    uint256 internal constant META_EXACT_IN = 4;

    bytes32 internal constant LOCK_SLOT = keccak256("seedix.lock");
    bytes32 internal constant STAGE_COIN = keccak256("seedix.stage.coin");
    bytes32 internal constant STAGE_PAIR = keccak256("seedix.stage.pair");
    bytes32 internal constant STAGE_BACKING = keccak256("seedix.stage.backing");
    bytes32 internal constant STAGE_META = keccak256("seedix.stage.meta");
    bytes32 internal constant META_SLOT = keccak256("seedix.meta");
    bytes32 internal constant HOOK_AMT_SLOT = keccak256("seedix.hookAmt");
    bytes32 internal constant PLAT_AMT_SLOT = keccak256("seedix.platAmt");

    struct CoinConfig {
        address coin;
        Currency pair;
        bool coinIsToken0;
        uint8 mode;
        bool isPlatform;
        uint40 launchTime;
        address feeRecipient;
    }

    struct Pots {
        uint128 creatorPair;
        uint128 creatorCoin;
        uint128 kickbackPair;
        uint128 burnPair;
        uint128 burnCoin;
    }

    struct Stage {
        address coin;
        Currency pair;
        bool coinIsToken0;
        uint8 mode;
        bool isPlatform;
        address feeRecipient;
    }

    event FeesTaken(
        PoolId indexed poolId,
        address indexed sender,
        bool pairSide,
        uint24 hookFeePips,
        uint256 hookAmt,
        uint256 platformAmt
    );

    IPoolManager public immutable poolManager;
    address public immutable buybackExecutor;
    /// @notice Kickback distributor. Immutable, so auto-push ships with a new hook on the next deploy.
    address public immutable kickbackDistributor;
    address public immutable feeVault;
    address public immutable initializer;

    address public launcher;
    address public locker;

    mapping(PoolId => CoinConfig) public config;
    /// @notice Backing token for Keep and Kickback. Zero means fees stay in WHYPE (Burn, or a WHYPE launch).
    mapping(PoolId => address) public backingOf;
    mapping(PoolId => Pots) public pots;
    mapping(Currency => uint256) public platformBurn;
    mapping(Currency => uint256) public platformWallet;
    mapping(Currency => uint256) public accounted;
    mapping(PoolId => OracleLib.State) internal _oracle;

    PoolId[] public pools;

    constructor(
        IPoolManager poolManager_,
        address feeVault_,
        address buybackExecutor_,
        address kickbackDistributor_,
        address initializer_
    ) {
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: true,
                afterInitialize: false,
                beforeAddLiquidity: true,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: true,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: true,
                afterSwapReturnDelta: true,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
        if (initializer_ == address(0)) revert NotInitializer();
        poolManager = poolManager_;
        feeVault = feeVault_;
        buybackExecutor = buybackExecutor_;
        kickbackDistributor = kickbackDistributor_;
        initializer = initializer_;
    }

    function setLauncher(address next) external {
        if (msg.sender != initializer || launcher != address(0) || next == address(0)) revert NotInitializer();
        launcher = next;
    }

    function setLocker(address next) external {
        if (msg.sender != initializer || locker != address(0) || next == address(0)) revert NotInitializer();
        locker = next;
    }

    /// @dev `potSum` is the accounted balance. One counter is enough.
    function potSum(Currency c) external view returns (uint256) {
        return accounted[c];
    }

    function poolCount() external view returns (uint256) {
        return pools.length;
    }

    function keyOf(PoolId id) public view returns (PoolKey memory) {
        CoinConfig memory cfg = config[id];
        if (cfg.launchTime == 0) revert UnknownPool();
        Currency coin = Currency.wrap(cfg.coin);
        (Currency c0, Currency c1) = cfg.coinIsToken0 ? (coin, cfg.pair) : (cfg.pair, coin);
        return PoolKey({
            currency0: c0, currency1: c1, fee: C.LP_FEE, tickSpacing: C.TICK_SPACING, hooks: IHooks(address(this))
        });
    }

    /// @notice Test helper. Do not call this on-chain once many pools exist.
    function sumPots(Currency c) public view returns (uint256 s) {
        s = platformBurn[c] + platformWallet[c];
        uint256 n = pools.length;
        for (uint256 i; i < n; ++i) {
            CoinConfig memory cfg = config[pools[i]];
            Pots memory p = pots[pools[i]];
            if (cfg.pair == c) s += uint256(p.creatorPair) + p.kickbackPair + p.burnPair;
            if (Currency.wrap(cfg.coin) == c) s += uint256(p.creatorCoin) + p.burnCoin;
        }
    }

    function observation(PoolId id, uint16 index)
        external
        view
        returns (uint32 timestamp, int56 tickCumulative, int24 tick)
    {
        OracleLib.Observation memory o = _oracle[id].obs[index];
        return (o.timestamp, o.tickCumulative, o.tick);
    }

    function observationCount(PoolId id) external view returns (uint16) {
        return _oracle[id].count;
    }

    function observationIndex(PoolId id) external view returns (uint16) {
        return _oracle[id].index;
    }

    function consult(PoolId id, uint32 window) external view returns (int24 twapTick, int24 spotTick) {
        if (config[id].launchTime == 0) revert UnknownPool();
        (, spotTick,,) = poolManager.getSlot0(id);
        twapTick = OracleLib.consult(_oracle[id], uint32(block.timestamp), window, spotTick);
    }

    function armLaunchGuard(PoolId id) external {
        if (msg.sender != launcher) revert NotLauncher();
        _tstore(_guardSlot(id), 1);
    }

    function stage(
        PoolKey calldata key,
        address coin,
        Currency pair,
        bool coinIsToken0,
        uint8 mode,
        bool isPlatform,
        address feeRecipient,
        address backing
    ) external {
        if (msg.sender != launcher) revert NotLauncher();
        if (_readStage().coin != address(0)) revert StageOccupied();
        _checkKey(key, coin, pair, coinIsToken0);
        _tstore(STAGE_BACKING, uint256(uint160(backing)));
        _writeStage(
            Stage({
                coin: coin,
                pair: pair,
                coinIsToken0: coinIsToken0,
                mode: mode,
                isPlatform: isPlatform,
                feeRecipient: feeRecipient
            })
        );
    }

    function beforeInitialize(address sender, PoolKey calldata key, uint160 sqrtPriceX96)
        external
        override
        returns (bytes4)
    {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        if (sender != launcher) revert NotLauncher();
        Stage memory s = _readStage();
        if (s.coin == address(0)) revert StageMissing();
        _checkKey(key, s.coin, s.pair, s.coinIsToken0);
        _clearStage();
        PoolId id = key.toId();
        if (config[id].launchTime != 0) revert PoolExists();
        config[id] = CoinConfig({
            coin: s.coin,
            pair: s.pair,
            coinIsToken0: s.coinIsToken0,
            mode: s.mode,
            isPlatform: s.isPlatform,
            launchTime: uint40(block.timestamp),
            feeRecipient: s.feeRecipient
        });
        backingOf[id] = address(uint160(_tload(STAGE_BACKING)));
        _tstore(STAGE_BACKING, 0);
        pools.push(id);
        OracleLib.init(_oracle[id], uint32(block.timestamp), TickMath.getTickAtSqrtPrice(sqrtPriceX96));
        return IHooks.beforeInitialize.selector;
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure override returns (bytes4) {
        return IHooks.afterInitialize.selector;
    }

    function beforeAddLiquidity(address sender, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        override
        returns (bytes4)
    {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        if (sender != locker) revert NotLocker();
        return IHooks.beforeAddLiquidity.selector;
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        return (IHooks.afterAddLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IHooks.beforeRemoveLiquidity.selector;
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        return (IHooks.afterRemoveLiquidity.selector, BalanceDelta.wrap(0));
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IHooks.beforeDonate.selector;
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IHooks.afterDonate.selector;
    }

    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        if (_tload(LOCK_SLOT) != 0) revert Locked();
        _tstore(LOCK_SLOT, LOCK_SWAP);

        PoolId id = key.toId();
        if (_tload(_guardSlot(id)) != 0) revert SwapDuringLaunch();
        CoinConfig memory cfg = config[id];
        if (cfg.launchTime == 0) revert UnknownPool();

        (, int24 tick,,) = poolManager.getSlot0(id);
        OracleLib.onSwap(_oracle[id], uint32(block.timestamp), tick);

        // Exemption is the PoolManager sender. The executor must call the manager itself, not a router.
        if (sender == buybackExecutor) {
            _tstore(META_SLOT, META_EXEMPT);
            return (IHooks.beforeSwap.selector, toBeforeSwapDelta(0, 0), 0);
        }

        bool exactIn = params.amountSpecified < 0;
        bool buy = _pairIsInput(cfg.coinIsToken0, params.zeroForOne);
        uint256 specified = _abs(params.amountSpecified);
        uint256 pips = FeeMath.hookFeePips(cfg.launchTime, block.timestamp);
        uint256 meta = (pips << 8) | (exactIn ? META_EXACT_IN : 0) | (buy ? META_BUY : 0);
        _tstore(META_SLOT, meta);

        int128 specifiedDelta;
        if (exactIn && buy) {
            (uint256 hookAmt, uint256 platAmt) = FeeMath.exactInBuy(specified, pips);
            _routeHook(id, cfg, true, hookAmt, pips);
            _routePlatform(cfg, platAmt);
            _remember(hookAmt, platAmt);
            uint256 total = hookAmt + platAmt;
            _mint(cfg.pair, total);
            specifiedDelta = _asInt128(total);
        } else if (exactIn && !buy) {
            uint256 hookAmt = FeeMath.feeDown(specified, pips);
            _routeHook(id, cfg, false, hookAmt, pips);
            _remember(hookAmt, 0);
            _mint(Currency.wrap(cfg.coin), hookAmt);
            specifiedDelta = _asInt128(hookAmt);
        } else if (!exactIn && !buy) {
            (, uint256 platAmt) = FeeMath.grossUp(specified, C.PLATFORM_FEE);
            _routePlatform(cfg, platAmt);
            _remember(0, platAmt);
            _mint(cfg.pair, platAmt);
            specifiedDelta = _asInt128(platAmt);
        }

        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(specifiedDelta, 0), 0);
    }

    function afterSwap(
        address sender,
        PoolKey calldata key,
        SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external override returns (bytes4, int128) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        if (_tload(LOCK_SLOT) != LOCK_SWAP) revert Locked();

        int128 unspecifiedDelta;
        if (_tload(META_SLOT) & META_EXEMPT == 0) {
            unspecifiedDelta = _settleAfter(sender, key, params, delta);
        }

        _tstore(LOCK_SLOT, 0);
        _tstore(META_SLOT, 0);
        _tstore(HOOK_AMT_SLOT, 0);
        _tstore(PLAT_AMT_SLOT, 0);
        return (IHooks.afterSwap.selector, unspecifiedDelta);
    }

    function debitCreatorPair(PoolId id, uint256 amount, address to) external {
        if (msg.sender != feeVault && msg.sender != buybackExecutor) revert NotVault();
        _openMove();
        Pots storage p = pots[id];
        if (amount == 0 || amount > p.creatorPair) revert Amount();
        p.creatorPair -= uint128(amount);
        Currency c = config[id].pair;
        _debitAccount(c, amount);
        _payout(c, to, amount);
        _closeMove();
    }

    function debitCreatorCoin(PoolId id, uint256 amount, address to) external {
        if (msg.sender != feeVault) revert NotVault();
        _openMove();
        Pots storage p = pots[id];
        if (amount == 0 || amount > p.creatorCoin) revert Amount();
        p.creatorCoin -= uint128(amount);
        Currency c = Currency.wrap(config[id].coin);
        _debitAccount(c, amount);
        _payout(c, to, amount);
        _closeMove();
    }

    /// @notice Moves the kickback pot to the distributor. The keeper pushes that balance to holders.
    function debitKickback(PoolId id, uint256 amount, address to) external {
        if (msg.sender != kickbackDistributor && msg.sender != buybackExecutor) revert NotDistributor();
        _openMove();
        Pots storage p = pots[id];
        if (amount == 0 || amount > p.kickbackPair) revert Amount();
        p.kickbackPair -= uint128(amount);
        Currency c = config[id].pair;
        _debitAccount(c, amount);
        _payout(c, to, amount);
        _closeMove();
    }

    function debitBurnCoin(PoolId id, uint256 amount, address to) external {
        if (msg.sender != buybackExecutor) revert NotExecutor();
        _openMove();
        Pots storage p = pots[id];
        if (amount == 0 || amount > p.burnCoin) revert Amount();
        p.burnCoin -= uint128(amount);
        Currency c = Currency.wrap(config[id].coin);
        _debitAccount(c, amount);
        _payout(c, to, amount);
        _closeMove();
    }

    function debitBurnPair(PoolId id, uint256 amount, address to) external {
        if (msg.sender != buybackExecutor) revert NotExecutor();
        _openMove();
        Pots storage p = pots[id];
        if (amount == 0 || amount > p.burnPair) revert Amount();
        p.burnPair -= uint128(amount);
        Currency c = config[id].pair;
        _debitAccount(c, amount);
        _payout(c, to, amount);
        _closeMove();
    }

    function debitPlatformWallet(Currency pair, uint256 amount, address to) external {
        if (msg.sender != feeVault) revert NotVault();
        _openMove();
        if (amount == 0 || amount > platformWallet[pair]) revert Amount();
        platformWallet[pair] -= amount;
        _debitAccount(pair, amount);
        _payout(pair, to, amount);
        _closeMove();
    }

    function debitPlatformBurn(Currency pair, uint256 amount, address to) external {
        if (msg.sender != buybackExecutor) revert NotExecutor();
        _openMove();
        if (amount == 0 || amount > platformBurn[pair]) revert Amount();
        platformBurn[pair] -= amount;
        _debitAccount(pair, amount);
        _payout(pair, to, amount);
        _closeMove();
    }

    function restoreKickback(PoolId id, uint256 amount) external {
        if (msg.sender != kickbackDistributor) revert NotDistributor();
        _openMove();
        if (amount == 0 || config[id].launchTime == 0) revert Amount();
        Currency c = config[id].pair;
        _pull(c, msg.sender, amount);
        Pots storage p = pots[id];
        p.kickbackPair = _asUint128(uint256(p.kickbackPair) + amount);
        _credit(c, amount);
        _closeMove();
    }

    /// @notice Stray ERC-20 sent to this hook. Pots are ERC-6909 claims on the PoolManager, not this balance.
    ///         A rebase of tokens inside the PoolManager is not visible here and is not recoverable.
    function recoverToken(address token, address to) external {
        if (msg.sender != address(IHasRoles(kickbackDistributor).roles().timelock())) revert NotTimelock();
        if (to == address(0)) revert Amount();
        uint256 beforeBal = IERC20(token).balanceOf(address(this));
        if (beforeBal == 0) revert Amount();
        IERC20(token).safeTransfer(to, beforeBal);
        if (IERC20(token).balanceOf(address(this)) != 0) revert Amount();
    }

    /// @dev Buyback executor deposits tokens it was paid (LP fees, seed remainder) into the burn pots.
    function depositCollected(PoolId id, Currency token, uint256 amount) external {
        if (msg.sender != buybackExecutor) revert NotExecutor();
        _openMove();
        CoinConfig memory cfg = config[id];
        if (cfg.launchTime == 0 || amount == 0) revert Amount();
        _pull(token, msg.sender, amount);
        if (token == cfg.pair) _addBurnPair(id, amount);
        else if (Currency.unwrap(token) == cfg.coin) _addBurnCoin(id, amount);
        else revert Amount();
        _closeMove();
    }

    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        if (_tload(LOCK_SLOT) != LOCK_MOVE) revert NotInitiator();
        (uint8 action, Currency c, address who, uint256 amount) = abi.decode(data, (uint8, Currency, address, uint256));
        if (action == ACTION_PAY) {
            poolManager.burn(address(this), c.toId(), amount);
            poolManager.take(c, who, amount);
        } else if (action == ACTION_PULL) {
            poolManager.sync(c);
            IERC20(Currency.unwrap(c)).safeTransferFrom(who, address(poolManager), amount);
            poolManager.settle();
            poolManager.mint(address(this), c.toId(), amount);
        } else {
            revert NotInitiator();
        }
        return "";
    }

    function _settleAfter(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta)
        internal
        returns (int128 unspecifiedDelta)
    {
        uint256 meta = _tload(META_SLOT);
        PoolId id = key.toId();
        CoinConfig memory cfg = config[id];
        bool exactIn = meta & META_EXACT_IN != 0;
        bool buy = meta & META_BUY != 0;
        uint256 pips = meta >> 8;
        bool specifiedIs0 = (params.amountSpecified < 0) == params.zeroForOne;
        int128 raw = specifiedIs0 ? delta.amount1() : delta.amount0();
        uint256 net = _abs128(raw);
        Currency unspecified = specifiedIs0 ? key.currency1 : key.currency0;
        unspecifiedDelta = _takeUnspecified(id, cfg, exactIn, buy, pips, net, unspecified);
        emit FeesTaken(id, sender, buy, uint24(pips), _tload(HOOK_AMT_SLOT), _tload(PLAT_AMT_SLOT));
    }

    function _takeUnspecified(
        PoolId id,
        CoinConfig memory cfg,
        bool exactIn,
        bool buy,
        uint256 pips,
        uint256 net,
        Currency unspecified
    ) internal returns (int128 unspecifiedDelta) {
        if (exactIn && !buy) {
            uint256 platAmt = FeeMath.feeDown(net, C.PLATFORM_FEE);
            _routePlatform(cfg, platAmt);
            _remember(0, platAmt);
            _mint(unspecified, platAmt);
            return _asInt128(platAmt);
        }
        if (!exactIn && buy) {
            (uint256 hookAmt, uint256 platAmt) = FeeMath.splitGross(net, pips);
            _routeHook(id, cfg, true, hookAmt, pips);
            _routePlatform(cfg, platAmt);
            _remember(hookAmt, platAmt);
            uint256 total = hookAmt + platAmt;
            _mint(unspecified, total);
            return _asInt128(total);
        }
        if (!exactIn && !buy) {
            (, uint256 hookAmt) = FeeMath.grossUp(net, pips);
            _routeHook(id, cfg, false, hookAmt, pips);
            _remember(hookAmt, 0);
            _mint(unspecified, hookAmt);
            return _asInt128(hookAmt);
        }
        return 0;
    }

    function _routeHook(PoolId id, CoinConfig memory cfg, bool pairSide, uint256 hookAmt, uint256 pips) internal {
        (uint256 baseAmt, uint256 excessAmt) = FeeMath.splitBaseExcess(hookAmt, pips);
        if (excessAmt > 0) {
            if (pairSide) _addBurnPair(id, excessAmt);
            else _addBurnCoin(id, excessAmt);
        }
        if (baseAmt == 0) return;
        if (cfg.isPlatform) {
            if (pairSide) _addPlatformBurn(cfg.pair, baseAmt);
            else _addBurnCoin(id, baseAmt);
            return;
        }
        if (cfg.mode == 0) {
            if (pairSide) _addCreatorPair(id, baseAmt);
            else _addCreatorCoin(id, baseAmt);
        } else if (cfg.mode == 1) {
            if (pairSide) _addKickback(id, baseAmt);
            else _addCreatorCoin(id, baseAmt);
        } else {
            if (pairSide) _addBurnPair(id, baseAmt);
            else _addBurnCoin(id, baseAmt);
        }
    }

    function _routePlatform(CoinConfig memory cfg, uint256 platAmt) internal {
        (uint256 burn, uint256 wallet) = FeeMath.splitPlatform(platAmt, cfg.isPlatform);
        if (burn > 0) _addPlatformBurn(cfg.pair, burn);
        if (wallet > 0) _addPlatformWallet(cfg.pair, wallet);
    }

    function _addCreatorPair(PoolId id, uint256 amt) internal {
        Pots storage p = pots[id];
        p.creatorPair = _asUint128(uint256(p.creatorPair) + amt);
        _credit(config[id].pair, amt);
    }

    function _addCreatorCoin(PoolId id, uint256 amt) internal {
        Pots storage p = pots[id];
        p.creatorCoin = _asUint128(uint256(p.creatorCoin) + amt);
        _credit(Currency.wrap(config[id].coin), amt);
    }

    function _addKickback(PoolId id, uint256 amt) internal {
        Pots storage p = pots[id];
        p.kickbackPair = _asUint128(uint256(p.kickbackPair) + amt);
        _credit(config[id].pair, amt);
    }

    function _addBurnPair(PoolId id, uint256 amt) internal {
        Pots storage p = pots[id];
        p.burnPair = _asUint128(uint256(p.burnPair) + amt);
        _credit(config[id].pair, amt);
    }

    function _addBurnCoin(PoolId id, uint256 amt) internal {
        Pots storage p = pots[id];
        p.burnCoin = _asUint128(uint256(p.burnCoin) + amt);
        _credit(Currency.wrap(config[id].coin), amt);
    }

    function _addPlatformBurn(Currency c, uint256 amt) internal {
        platformBurn[c] += amt;
        _credit(c, amt);
    }

    function _addPlatformWallet(Currency c, uint256 amt) internal {
        platformWallet[c] += amt;
        _credit(c, amt);
    }

    function _credit(Currency c, uint256 amt) internal {
        accounted[c] += amt;
    }

    function _debitAccount(Currency c, uint256 amt) internal {
        accounted[c] -= amt;
    }

    function _readStage() internal view returns (Stage memory s) {
        s.coin = address(uint160(_tload(STAGE_COIN)));
        s.pair = Currency.wrap(address(uint160(_tload(STAGE_PAIR))));
        uint256 meta = _tload(STAGE_META);
        s.feeRecipient = address(uint160(meta));
        s.coinIsToken0 = meta & (1 << 160) != 0;
        s.mode = uint8((meta >> 161) & 0xff);
        s.isPlatform = meta & (1 << 169) != 0;
    }

    function _writeStage(Stage memory s) internal {
        _tstore(STAGE_COIN, uint256(uint160(s.coin)));
        _tstore(STAGE_PAIR, uint256(uint160(Currency.unwrap(s.pair))));
        uint256 meta = uint256(uint160(s.feeRecipient));
        if (s.coinIsToken0) meta |= uint256(1) << 160;
        meta |= uint256(s.mode) << 161;
        if (s.isPlatform) meta |= uint256(1) << 169;
        _tstore(STAGE_META, meta);
    }

    function _clearStage() internal {
        _tstore(STAGE_COIN, 0);
        _tstore(STAGE_PAIR, 0);
        _tstore(STAGE_META, 0);
    }

    function _mint(Currency c, uint256 amt) internal {
        if (amt == 0) return;
        poolManager.mint(address(this), c.toId(), amt);
    }

    function _payout(Currency c, address to, uint256 amount) internal {
        poolManager.unlock(abi.encode(ACTION_PAY, c, to, amount));
    }

    function _pull(Currency c, address from, uint256 amount) internal {
        poolManager.unlock(abi.encode(ACTION_PULL, c, from, amount));
    }

    function _openMove() internal {
        if (_tload(LOCK_SLOT) != 0) revert Locked();
        _tstore(LOCK_SLOT, LOCK_MOVE);
    }

    function _closeMove() internal {
        _tstore(LOCK_SLOT, 0);
    }

    function _remember(uint256 hookAmt, uint256 platAmt) internal {
        if (hookAmt > 0) _tstore(HOOK_AMT_SLOT, _tload(HOOK_AMT_SLOT) + hookAmt);
        if (platAmt > 0) _tstore(PLAT_AMT_SLOT, _tload(PLAT_AMT_SLOT) + platAmt);
    }

    function _checkKey(PoolKey calldata key, address coin, Currency pair, bool coinIsToken0) internal view {
        if (key.fee != C.LP_FEE || key.tickSpacing != C.TICK_SPACING) revert BadKey();
        if (address(key.hooks) != address(this)) revert BadKey();
        if (coinIsToken0) {
            if (Currency.unwrap(key.currency0) != coin || Currency.unwrap(key.currency1) != Currency.unwrap(pair)) {
                revert BadKey();
            }
        } else if (Currency.unwrap(key.currency0) != Currency.unwrap(pair) || Currency.unwrap(key.currency1) != coin) {
            revert BadKey();
        }
    }

    function _pairIsInput(bool coinIsToken0, bool zeroForOne) internal pure returns (bool) {
        return coinIsToken0 != zeroForOne;
    }

    function _guardSlot(PoolId id) internal pure returns (bytes32) {
        return keccak256(abi.encode("seedix.launch", PoolId.unwrap(id)));
    }

    function _abs(int256 v) internal pure returns (uint256) {
        if (v == type(int256).min) revert FeeTooLarge();
        return uint256(v < 0 ? -v : v);
    }

    function _abs128(int128 v) internal pure returns (uint256) {
        if (v == type(int128).min) revert FeeTooLarge();
        return uint256(uint128(v < 0 ? -v : v));
    }

    function _asInt128(uint256 v) internal pure returns (int128) {
        if (v > uint256(uint128(type(int128).max))) revert FeeTooLarge();
        return int128(uint128(v));
    }

    function _asUint128(uint256 v) internal pure returns (uint128) {
        if (v > type(uint128).max) revert Overflow();
        return uint128(v);
    }

    function _tstore(bytes32 slot, uint256 value) internal {
        assembly {
            tstore(slot, value)
        }
    }

    function _tload(bytes32 slot) internal view returns (uint256 value) {
        assembly {
            value := tload(slot)
        }
    }
}
