// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SeedixRoles} from "../access/SeedixRoles.sol";
import {SeedixConstants as C} from "../libraries/SeedixConstants.sol";
import {LaunchCurve} from "../libraries/LaunchCurve.sol";
import {LaunchHook} from "../hook/LaunchHook.sol";
import {LaunchToken} from "../token/LaunchToken.sol";
import {LiquidityLocker} from "./LiquidityLocker.sol";
import {BuybackExecutor} from "../buyback/BuybackExecutor.sol";

/// @notice Ownerless launcher. One transaction deploys the coin, initialises the pool, and seeds it.
///         Swaps in that same transaction revert. Pause is instant for the guardian role.
///
///         Every pool is coin/WHYPE. `pair` on a Keep or Kickback launch is the backing token.
///         Burn has no backing token. Vetted backing tokens may use Kickback. A pasted backing
///         token may use Keep only. Rebasing backing is unsafe for the conversion route.
contract Launcher {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;

    error NotGuardian();
    error NotAdmin();
    error NotTimelock();
    error NotInitializer();
    error Paused();
    error BadArgs();
    error PairNotAllowed();
    error BadRecipient();
    error RateLimited();
    error PlatformAlreadyLaunched();
    error TighteningOnly();
    error UnsafePair();
    error PairRefused();
    error KickbackNeedsVetted();
    error RouteNotReady();
    error FeeOnTransfer();
    error Reentered();
    error CreatorTaxZero();

    uint8 public constant STATUS_UNKNOWN = 0;
    uint8 public constant STATUS_VETTED = 1;
    uint8 public constant STATUS_UNVETTED = 2;
    uint8 public constant STATUS_REFUSED = 3;
    uint8 public constant CATEGORY_CRYPTO = 0;
    uint8 public constant CATEGORY_STOCK = 1;
    uint8 public constant CATEGORY_PREIPO = 2;
    uint8 public constant MODE_KICKBACK = 1;

    struct LaunchParams {
        string name;
        string symbol;
        address pair;
        uint8 mode;
        address feeRecipient;
        address teamWallet;
        uint16 teamBps;
        uint256 startMcapInPair;
    }

    struct Inspection {
        bool ok;
        bool codePresent;
        bool metadataOk;
        bool decimalsOk;
        bool launchToken;
        bool protocol;
        bool refused;
        bool kickbackAllowed;
        bool routeReady;
        bool feeProbeRequired;
        uint8 status;
        uint8 category;
        uint8 decimals;
        uint256 routeDepth;
        uint256 minDepth;
        string name;
        string symbol;
    }

    event CoinLaunched(
        PoolId indexed poolId,
        address indexed coin,
        address indexed pair,
        uint8 mode,
        bool isPlatform,
        address feeRecipient,
        address teamWallet,
        uint256 teamAmount,
        uint256 startMcap,
        uint8 category,
        uint8 pairStatus,
        address backing
    );
    event LaunchesPaused(address indexed by);
    event LaunchesUnpaused();
    event PairAllowed(address indexed pair, bool allowed);
    event PairClassified(address indexed pair, uint8 status, uint8 category);
    event StartMcapSet(uint256 next);

    SeedixRoles public immutable roles;
    IPoolManager public immutable poolManager;
    LaunchHook public immutable hook;
    LiquidityLocker public immutable locker;
    LaunchToken public immutable implementation;
    BuybackExecutor public immutable executor;
    address public immutable initializer;

    bool public launchesPaused;
    /// @notice Optional. Coins launched after this is set report holding time to the ZRO tracker.
    address public zroWeightTracker;
    bool public platformLaunched;
    bool public categoriesBootstrapped;
    mapping(PoolId => address) public creatorOf;
    mapping(address => uint8) public statusOf;
    /// @notice True for coins this launcher created. Graduation treats this as the coin registry.
    mapping(address => bool) public isLaunchedCoin;
    mapping(address => uint8) public categoryOf;
    /// @notice Default starting market cap, in WHYPE wei. A launch still uses
    ///         `startMcapInPair`. 34 WHYPE is about $2,500 at $74.6 per HYPE.
    uint256 public startMcap = 34 ether;
    uint256 public maxLaunchesPerHour;
    uint256 public windowStart;
    uint256 public launchesInWindow;
    uint256 public launchNonce;
    uint256 private _entered;

    constructor(
        SeedixRoles roles_,
        IPoolManager poolManager_,
        LaunchHook hook_,
        LiquidityLocker locker_,
        LaunchToken implementation_,
        BuybackExecutor executor_,
        address initializer_,
        address[] memory pairs
    ) {
        if (initializer_ == address(0)) revert NotInitializer();
        roles = roles_;
        poolManager = poolManager_;
        hook = hook_;
        locker = locker_;
        implementation = implementation_;
        executor = executor_;
        initializer = initializer_;
        uint256 n = pairs.length;
        for (uint256 i; i < n; ++i) {
            if (pairs[i] == address(0)) revert BadArgs();
            statusOf[pairs[i]] = STATUS_VETTED;
            emit PairAllowed(pairs[i], true);
            emit PairClassified(pairs[i], STATUS_VETTED, CATEGORY_CRYPTO);
        }
    }

    function pairAllowed(address pair) external view returns (bool) {
        return statusOf[pair] == STATUS_VETTED;
    }

    /// @notice Read-only preflight. The fee-on-transfer probe is not in here. It moves tokens,
    ///         so `probePair` and `launch` run it. `feeProbeRequired` tells the UI that.
    function inspect(address pair) external view returns (Inspection memory info) {
        info.status = statusOf[pair];
        info.category = categoryOf[pair];
        info.minDepth = executor.minRouteDepth();
        info.refused = info.status == STATUS_REFUSED;
        info.kickbackAllowed = info.status == STATUS_VETTED;
        info.feeProbeRequired = info.status != STATUS_VETTED && info.status != STATUS_REFUSED;
        if (pair.code.length == 0) return info;
        info.codePresent = true;
        info.launchToken = pair == address(implementation) || _isLaunchClone(pair);
        info.protocol = _isProtocol(pair);
        (info.metadataOk, info.name, info.symbol, info.decimals) = _tryMeta(pair);
        info.decimalsOk = info.metadataOk && info.decimals >= 6 && info.decimals <= 18;
        address whype = Currency.unwrap(executor.whype());
        if (pair == whype) {
            info.routeReady = true;
        } else if (executor.routeOk(Currency.wrap(pair))) {
            info.routeReady = true;
            info.routeDepth = executor.routeDepth(Currency.wrap(pair));
        }
        info.ok = info.codePresent && info.metadataOk && info.decimalsOk && !info.launchToken && !info.protocol
            && !info.refused && info.routeReady;
    }

    /// @notice Balance-delta probe. Refunds whatever arrived. `eth_call` this for a preflight.
    function probePair(address pair) external returns (bool exact) {
        return _probe(pair);
    }

    function launch(LaunchParams calldata params) external returns (address coin, PoolId id) {
        return _launch(params, false);
    }

    /// @notice One-shot. Admin only. Forces Burn mode and marks the pool as the platform token.
    function launchPlatformToken(LaunchParams calldata params) external returns (address coin, PoolId id) {
        if (msg.sender != roles.admin()) revert NotAdmin();
        if (platformLaunched) revert PlatformAlreadyLaunched();
        platformLaunched = true;
        (coin, id) = _launch(params, true);
        executor.setPlatform(id, coin);
        locker.setLpRecipient(id, address(executor));
    }

    function pause() external {
        if (msg.sender != roles.guardian()) revert NotGuardian();
        launchesPaused = true;
        emit LaunchesPaused(msg.sender);
    }

    function unpause() external {
        if (msg.sender != address(roles.timelock())) revert NotTimelock();
        launchesPaused = false;
        emit LaunchesUnpaused();
    }

    /// @notice `allowed` marks the pair vetted in Crypto, or refuses it.
    ///         Category changes go through `setPair` or `bootstrapCategories`.
    function setPairAllowed(address pair, bool allowed) external {
        if (pair == address(0)) revert BadArgs();
        if (allowed) {
            if (msg.sender != address(roles.timelock())) revert NotTimelock();
            statusOf[pair] = STATUS_VETTED;
        } else {
            if (msg.sender != roles.guardian() && msg.sender != address(roles.timelock())) revert NotGuardian();
            statusOf[pair] = STATUS_REFUSED;
        }
        emit PairAllowed(pair, allowed);
        emit PairClassified(pair, statusOf[pair], categoryOf[pair]);
    }

    /// @notice Timelock sets vetted, unvetted, or unknown, and the category.
    ///         The guardian may only refuse. A refusal does not relabel the category.
    function setPair(address pair, uint8 status, uint8 category) external {
        if (pair == address(0) || pair.code.length == 0) revert BadArgs();
        if (status > STATUS_REFUSED || category > CATEGORY_PREIPO) revert BadArgs();
        if (status == STATUS_REFUSED) {
            if (msg.sender != roles.guardian() && msg.sender != address(roles.timelock())) revert NotGuardian();
        } else if (msg.sender != address(roles.timelock())) {
            revert NotTimelock();
        }
        statusOf[pair] = status;
        if (status != STATUS_REFUSED) categoryOf[pair] = category;
        emit PairAllowed(pair, status == STATUS_VETTED);
        emit PairClassified(pair, statusOf[pair], categoryOf[pair]);
    }

    /// @notice One-shot category labels for pairs the constructor already vetted.
    function bootstrapCategories(address[] calldata tokens, uint8[] calldata categories) external {
        if (msg.sender != initializer || categoriesBootstrapped) revert NotInitializer();
        if (tokens.length != categories.length) revert BadArgs();
        categoriesBootstrapped = true;
        uint256 n = tokens.length;
        for (uint256 i; i < n; ++i) {
            if (statusOf[tokens[i]] != STATUS_VETTED) revert BadArgs();
            if (categories[i] > CATEGORY_PREIPO) revert BadArgs();
            categoryOf[tokens[i]] = categories[i];
            emit PairClassified(tokens[i], STATUS_VETTED, categories[i]);
        }
    }

    function setZroWeightTracker(address next) external {
        if (msg.sender != initializer || zroWeightTracker != address(0) || next == address(0)) revert NotInitializer();
        zroWeightTracker = next;
    }

    /// @notice Same launch, then the creator tax is enabled. The rate has to be above zero.
    ///         ON_TOP adds the 1% Seedix fee on top of that rate.
    function launchWithZroTax(LaunchParams calldata params, uint16 creatorTaxBps)
        external
        returns (address coin, PoolId id)
    {
        if (creatorTaxBps == 0) revert CreatorTaxZero();
        (coin, id) = _launch(params, false);
        hook.setCreatorTaxFromLauncher(id, creatorTaxBps);
    }

    function setMaxLaunchesPerHour(uint256 next) external {
        if (msg.sender == roles.guardian()) {
            if (next == 0 || (maxLaunchesPerHour != 0 && next >= maxLaunchesPerHour)) revert TighteningOnly();
        } else if (msg.sender != address(roles.timelock())) {
            revert NotTimelock();
        }
        maxLaunchesPerHour = next;
    }

    /// @notice Timelock sets the default starting market cap in WHYPE wei.
    function setStartMcap(uint256 next) external {
        if (msg.sender != address(roles.timelock())) revert NotTimelock();
        if (next < 1) revert BadArgs();
        startMcap = next;
        emit StartMcapSet(next);
    }

    struct Built {
        address coin;
        bool coinIsToken0;
        uint256 liqAmt;
        uint256 teamAmt;
    }

    function _launch(LaunchParams calldata params, bool isPlatform) internal returns (address coin, PoolId id) {
        if (_entered == 1) revert Reentered();
        _entered = 1;
        if (launchesPaused) revert Paused();
        _check(params, isPlatform);
        _consumeRate();
        Built memory built = _buildCoin(params);
        coin = built.coin;
        id = _openPool(params, isPlatform, built);
        _entered = 0;
    }

    function _buildCoin(LaunchParams calldata params) internal returns (Built memory built) {
        built.teamAmt = C.SUPPLY * params.teamBps / 10_000;
        built.liqAmt = C.SUPPLY - built.teamAmt;
        bytes32 salt = keccak256(abi.encode(msg.sender, launchNonce++, params.name, params.symbol, params.pair));
        built.coin = Clones.cloneDeterministic(address(implementation), salt);
        LaunchToken(built.coin)
            .initialize(params.name, params.symbol, address(this), built.liqAmt, params.teamWallet, built.teamAmt);
        isLaunchedCoin[built.coin] = true;
    }

    function _openPool(LaunchParams calldata params, bool isPlatform, Built memory built) internal returns (PoolId id) {
        uint8 mode = isPlatform ? 2 : params.mode;
        address whype = Currency.unwrap(executor.whype());
        address backing = (!isPlatform && mode != 2 && params.pair != whype) ? params.pair : address(0);
        if (backing != address(0) && statusOf[backing] == STATUS_UNKNOWN) {
            statusOf[backing] = STATUS_UNVETTED;
            categoryOf[backing] = CATEGORY_CRYPTO;
            emit PairClassified(backing, STATUS_UNVETTED, CATEGORY_CRYPTO);
        }
        built.coinIsToken0 = uint160(built.coin) < uint160(whype);
        Currency pair = Currency.wrap(whype);
        Currency coinCur = Currency.wrap(built.coin);
        PoolKey memory key = PoolKey({
            currency0: built.coinIsToken0 ? coinCur : pair,
            currency1: built.coinIsToken0 ? pair : coinCur,
            fee: C.LP_FEE,
            tickSpacing: C.TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        id = key.toId();
        creatorOf[id] = msg.sender;
        LaunchCurve.Plan memory curve = LaunchCurve.plan(built.coinIsToken0, params.startMcapInPair, built.liqAmt);
        hook.armLaunchGuard(id);
        hook.stage(key, built.coin, pair, built.coinIsToken0, mode, isPlatform, params.feeRecipient, backing);
        poolManager.initialize(key, curve.sqrtPriceX96);
        IERC20(built.coin).safeTransfer(address(locker), built.liqAmt);
        locker.seed(key, curve.near, curve.far);
        emit CoinLaunched(
            id,
            built.coin,
            whype,
            mode,
            isPlatform,
            params.feeRecipient,
            params.teamWallet,
            built.teamAmt,
            params.startMcapInPair,
            backing == address(0) ? CATEGORY_CRYPTO : categoryOf[backing],
            backing == address(0) ? STATUS_VETTED : statusOf[backing],
            backing
        );
    }

    function _check(LaunchParams calldata params, bool isPlatform) internal {
        uint256 nameLen = bytes(params.name).length;
        uint256 symLen = bytes(params.symbol).length;
        if (nameLen == 0 || nameLen > 32 || symLen == 0 || symLen > 8) revert BadArgs();
        if (!isPlatform && params.mode > 2) revert BadArgs();
        address whype = Currency.unwrap(executor.whype());
        bool burn = isPlatform || params.mode == 2;
        if (!burn && params.pair != whype) {
            if (params.pair.code.length == 0) revert UnsafePair();
            if (_isProtocol(params.pair) || params.pair == address(implementation) || _isLaunchClone(params.pair)) {
                revert UnsafePair();
            }
            uint8 status = statusOf[params.pair];
            if (status == STATUS_REFUSED) revert PairRefused();
            if (status != STATUS_VETTED) {
                (bool meta,,,) = _tryMeta(params.pair);
                if (!meta) revert UnsafePair();
                uint8 dec = _decimals(params.pair);
                if (dec < 6 || dec > 18) revert UnsafePair();
                if (!_probe(params.pair)) revert FeeOnTransfer();
            }
            if (params.mode == MODE_KICKBACK && status != STATUS_VETTED) revert KickbackNeedsVetted();
            if (!executor.routeOk(Currency.wrap(params.pair))) revert RouteNotReady();
        }
        if (params.teamBps > C.MAX_TEAM_BPS) revert BadArgs();
        if (params.teamBps > 0 && params.teamWallet == address(0)) revert BadArgs();
        if (params.startMcapInPair == 0) revert BadArgs();
        address r = params.feeRecipient;
        if (r == address(0) || r == C.DEAD || r == C.FEE_WALLET) revert BadRecipient();
    }

    function _probe(address pair) internal returns (bool exact) {
        uint256 amount = _probeAmount(pair);
        uint256 beforeBal = IERC20(pair).balanceOf(address(this));
        IERC20(pair).safeTransferFrom(msg.sender, address(this), amount);
        uint256 mid = IERC20(pair).balanceOf(address(this));
        exact = mid == beforeBal + amount;
        uint256 got = mid > beforeBal ? mid - beforeBal : 0;
        if (got > 0) IERC20(pair).safeTransfer(msg.sender, got);
    }

    function _probeAmount(address pair) internal view returns (uint256) {
        uint8 dec = _decimals(pair);
        if (dec < 6 || dec > 18) revert UnsafePair();
        return 10 ** (uint256(dec) - 2);
    }

    function _decimals(address pair) internal view returns (uint8) {
        (bool ok, bytes memory data) = pair.staticcall(abi.encodeWithSignature("decimals()"));
        if (!ok || data.length < 32) revert UnsafePair();
        return abi.decode(data, (uint8));
    }

    function _tryMeta(address pair)
        internal
        view
        returns (bool ok, string memory name, string memory symbol, uint8 decimals)
    {
        (bool dOk, bytes memory dData) = pair.staticcall(abi.encodeWithSignature("decimals()"));
        if (!dOk || dData.length < 32) return (false, "", "", 0);
        decimals = abi.decode(dData, (uint8));
        (bool nOk, bytes memory nData) = pair.staticcall(abi.encodeWithSignature("name()"));
        (bool sOk, bytes memory sData) = pair.staticcall(abi.encodeWithSignature("symbol()"));
        if (!nOk || !sOk || nData.length < 64 || sData.length < 64) return (false, "", "", decimals);
        name = abi.decode(nData, (string));
        symbol = abi.decode(sData, (string));
        ok = bytes(name).length > 0 && bytes(name).length <= 64 && bytes(symbol).length > 0
            && bytes(symbol).length <= 16;
    }

    function _isLaunchClone(address token) internal view returns (bool) {
        bytes memory code = token.code;
        if (code.length != 45) return false;
        address impl;
        assembly {
            impl := shr(96, mload(add(code, 42)))
        }
        return impl == address(implementation);
    }

    function _isProtocol(address token) internal view returns (bool) {
        return token == address(hook) || token == address(locker) || token == address(executor)
            || token == address(poolManager) || token == address(this) || token == hook.feeVault()
            || token == hook.kickbackDistributor() || token == address(0) || token == C.DEAD;
    }

    function _consumeRate() internal {
        if (maxLaunchesPerHour == 0) return;
        if (block.timestamp >= windowStart + 1 hours) {
            windowStart = block.timestamp;
            launchesInWindow = 0;
        }
        if (launchesInWindow >= maxLaunchesPerHour) revert RateLimited();
        launchesInWindow += 1;
    }
}
