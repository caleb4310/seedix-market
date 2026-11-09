// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SeedixRoles} from "../access/SeedixRoles.sol";
import {SeedixConstants as C} from "../libraries/SeedixConstants.sol";
import {LaunchCurve} from "../libraries/LaunchCurve.sol";
import {LaunchHook} from "../hook/LaunchHook.sol";
import {LaunchToken} from "../token/LaunchToken.sol";
import {LiquidityLocker} from "./LiquidityLocker.sol";
import {BuybackExecutor} from "../buyback/BuybackExecutor.sol";

/// @notice Ownerless launcher. One transaction deploys the coin, initialises the pool, and seeds it.
///         Swaps in that same transaction revert. Pause is instant for the guardian role.
contract Launcher {
    using PoolIdLibrary for PoolKey;

    error NotGuardian();
    error NotAdmin();
    error NotTimelock();
    error Paused();
    error BadArgs();
    error PairNotAllowed();
    error BadRecipient();
    error RateLimited();
    error PlatformAlreadyLaunched();
    error TighteningOnly();

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

    event CoinLaunched(
        PoolId indexed poolId,
        address indexed coin,
        address indexed pair,
        uint8 mode,
        bool isPlatform,
        address feeRecipient,
        address teamWallet,
        uint256 teamAmount,
        uint256 startMcap
    );
    event LaunchesPaused(address indexed by);
    event LaunchesUnpaused();
    event PairAllowed(address indexed pair, bool allowed);

    SeedixRoles public immutable roles;
    IPoolManager public immutable poolManager;
    LaunchHook public immutable hook;
    LiquidityLocker public immutable locker;
    LaunchToken public immutable implementation;
    BuybackExecutor public immutable executor;

    bool public launchesPaused;
    bool public platformLaunched;
    mapping(address => bool) public pairAllowed;
    uint256 public maxLaunchesPerHour;
    uint256 public windowStart;
    uint256 public launchesInWindow;
    uint256 public launchNonce;

    constructor(
        SeedixRoles roles_,
        IPoolManager poolManager_,
        LaunchHook hook_,
        LiquidityLocker locker_,
        LaunchToken implementation_,
        BuybackExecutor executor_,
        address[] memory pairs
    ) {
        roles = roles_;
        poolManager = poolManager_;
        hook = hook_;
        locker = locker_;
        implementation = implementation_;
        executor = executor_;
        uint256 n = pairs.length;
        for (uint256 i; i < n; ++i) {
            if (pairs[i] == address(0)) revert BadArgs();
            pairAllowed[pairs[i]] = true;
            emit PairAllowed(pairs[i], true);
        }
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

    function setPairAllowed(address pair, bool allowed) external {
        if (pair == address(0)) revert BadArgs();
        if (allowed) {
            if (msg.sender != address(roles.timelock())) revert NotTimelock();
        } else if (msg.sender != roles.guardian() && msg.sender != address(roles.timelock())) {
            revert NotGuardian();
        }
        pairAllowed[pair] = allowed;
        emit PairAllowed(pair, allowed);
    }

    function setMaxLaunchesPerHour(uint256 next) external {
        if (msg.sender == roles.guardian()) {
            if (next == 0 || (maxLaunchesPerHour != 0 && next >= maxLaunchesPerHour)) revert TighteningOnly();
        } else if (msg.sender != address(roles.timelock())) {
            revert NotTimelock();
        }
        maxLaunchesPerHour = next;
    }

    struct Built {
        address coin;
        bool coinIsToken0;
        uint256 liqAmt;
        uint256 teamAmt;
    }

    function _launch(LaunchParams calldata params, bool isPlatform) internal returns (address coin, PoolId id) {
        if (launchesPaused) revert Paused();
        _check(params, isPlatform);
        _consumeRate();
        Built memory built = _buildCoin(params);
        coin = built.coin;
        id = _openPool(params, isPlatform, built);
    }

    function _buildCoin(LaunchParams calldata params) internal returns (Built memory built) {
        built.teamAmt = C.SUPPLY * params.teamBps / 10_000;
        built.liqAmt = C.SUPPLY - built.teamAmt;
        bytes32 salt = keccak256(abi.encode(msg.sender, launchNonce++, params.name, params.symbol, params.pair));
        built.coin = Clones.cloneDeterministic(address(implementation), salt);
        built.coinIsToken0 = uint160(built.coin) < uint160(params.pair);
        LaunchToken(built.coin)
            .initialize(params.name, params.symbol, address(this), built.liqAmt, params.teamWallet, built.teamAmt);
    }

    function _openPool(LaunchParams calldata params, bool isPlatform, Built memory built) internal returns (PoolId id) {
        uint8 mode = isPlatform ? 2 : params.mode;
        Currency pair = Currency.wrap(params.pair);
        Currency coinCur = Currency.wrap(built.coin);
        PoolKey memory key = PoolKey({
            currency0: built.coinIsToken0 ? coinCur : pair,
            currency1: built.coinIsToken0 ? pair : coinCur,
            fee: C.LP_FEE,
            tickSpacing: C.TICK_SPACING,
            hooks: IHooks(address(hook))
        });
        id = key.toId();
        LaunchCurve.Plan memory curve = LaunchCurve.plan(built.coinIsToken0, params.startMcapInPair, built.liqAmt);
        hook.armLaunchGuard(id);
        hook.stage(key, built.coin, pair, built.coinIsToken0, mode, isPlatform, params.feeRecipient);
        poolManager.initialize(key, curve.sqrtPriceX96);
        IERC20(built.coin).transfer(address(locker), built.liqAmt);
        locker.seed(key, curve.near, curve.far);
        emit CoinLaunched(
            id,
            built.coin,
            params.pair,
            mode,
            isPlatform,
            params.feeRecipient,
            params.teamWallet,
            built.teamAmt,
            params.startMcapInPair
        );
    }

    function _check(LaunchParams calldata params, bool isPlatform) internal view {
        uint256 nameLen = bytes(params.name).length;
        uint256 symLen = bytes(params.symbol).length;
        if (nameLen == 0 || nameLen > 32 || symLen == 0 || symLen > 8) revert BadArgs();
        if (!isPlatform && params.mode > 2) revert BadArgs();
        if (!pairAllowed[params.pair] || params.pair.code.length == 0) revert PairNotAllowed();
        if (params.teamBps > C.MAX_TEAM_BPS) revert BadArgs();
        if (params.teamBps > 0 && params.teamWallet == address(0)) revert BadArgs();
        if (params.startMcapInPair == 0) revert BadArgs();
        address r = params.feeRecipient;
        if (r == address(0) || r == C.DEAD || r == C.FEE_WALLET) revert BadRecipient();
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
