// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";
import {IPositionDescriptor} from "@uniswap/v4-periphery/src/interfaces/IPositionDescriptor.sol";
import {IWETH9} from "@uniswap/v4-periphery/src/interfaces/external/IWETH9.sol";
import {PositionManager} from "@uniswap/v4-periphery/src/PositionManager.sol";
import {StateView} from "@uniswap/v4-periphery/src/lens/StateView.sol";
import {V4Quoter} from "@uniswap/v4-periphery/src/lens/V4Quoter.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";
import {MockXStock} from "../src/token/MockXStock.sol";
import {LaunchToken} from "../src/token/LaunchToken.sol";
import {LaunchHook} from "../src/hook/LaunchHook.sol";
import {LiquidityLocker} from "../src/launch/LiquidityLocker.sol";
import {Launcher} from "../src/launch/Launcher.sol";
import {RouteSeeder} from "../src/launch/RouteSeeder.sol";
import {CoinMetadata} from "../src/launch/CoinMetadata.sol";
import {FeeVault} from "../src/vault/FeeVault.sol";
import {BuybackExecutor} from "../src/buyback/BuybackExecutor.sol";
import {KickbackDistributor} from "../src/kickback/KickbackDistributor.sol";
import {SeedixRoles} from "../src/access/SeedixRoles.sol";
import {SeedixRouter} from "../src/router/SeedixRouter.sol";

/// @notice Testnet deploy. Refuses every chain except 99801 and local Anvil.
///         Do not pass --broadcast against a public RPC.
contract DeploySeedix is Script {
    error ForbiddenChain(uint256 chainId);
    error AdminIsFeeWallet(address admin);
    error RolesCollide(address a, address b);
    error FeeWalletReuse(address wallet);
    error MainnetUsesCanonicalStack(uint256 chainId);
    error Permit2Missing();
    error MissingCode(address target);
    error SeedBudget(uint256 total, uint256 cap);

    /// @dev One tick spacing of WHYPE. Seven pools at 0.15 is 1.05 WHYPE, under the 1.5 cap.
    ///      Each pool is funded with that amount once. Leftover tokens return to the deployer.
    ///      Mainnet default is `SeedixConstants.MAINNET_MIN_ROUTE_DEPTH` (10_000 WHYPE).
    uint256 internal constant TESTNET_MIN_ROUTE_DEPTH = 0.15 ether;
    uint256 internal constant SEED_BUDGET = 1.5 ether;

    struct Result {
        address deployer;
        address admin;
        address timelock;
        address roles;
        address vault;
        address executor;
        address distributor;
        address hook;
        address launcher;
        address locker;
    }

    Result public last;
    /// @dev The helper that seeded the routes. Leftover tokens are swept back to the deployer.
    address public routeSeeder;

    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    /// @dev `new {salt}` in a Forge script is CREATE2 from the Arachnid deployer, not the EOA.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant WHYPE_99801 = 0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234;
    address internal constant USDC_99801 = 0x7D29d8047B905000459c0E80c34a26CeedcB47b2;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address admin = vm.envOr("ADMIN", vm.addr(pk));
        address publisher = vm.envOr("KICKBACK_PUBLISHER", admin);
        address keeper = vm.envOr("KEEPER", address(0));
        deploy(pk, admin, publisher, keeper);
    }

    /// @dev `admin` receives the admin, guardian, proposer, and executor roles. The broadcasting key keeps none.
    function deploy(uint256 pk, address admin, address publisher) public {
        deploy(pk, admin, publisher, address(0));
    }

    /// @dev `keeper` receives the buyback keeper and the kickback keeper. The zero address burns the
    ///      deploy-time grant so the deployer cannot assign one later. `admin == deployer` still keeps
    ///      the timelock proposer, executor, and canceller roles.
    /// @notice Mainnet config guard. Admin must be a multisig and must not be the fee wallet.
    ///         Returns the keeper delay the mainnet executor must be constructed with.
    function requireMainnetAdmin(address admin) public view returns (uint256 keeperDelay) {
        if (block.chainid != 99901) revert ForbiddenChain(block.chainid);
        if (admin == address(0) || admin == C.FEE_WALLET) revert AdminIsFeeWallet(admin);
        return 48 hours;
    }

    function deploy(uint256 pk, address admin, address publisher, address keeper) public {
        if (block.chainid == 99901) revert MainnetUsesCanonicalStack(block.chainid);
        if (block.chainid != 99801 && block.chainid != 31337) revert ForbiddenChain(block.chainid);
        address deployer = vm.addr(pk);
        if (admin == address(0)) admin = deployer;
        if (publisher == address(0)) publisher = admin;

        vm.startBroadcast(pk);

        (address whype, address usdc, address permit2) = _canonicalOrMock(deployer);
        IPoolManager manager = IPoolManager(address(new PoolManager(address(0))));

        address nvda = address(new MockXStock("Wrapped NVIDIA xStock", "wNVDAx", 18, deployer));
        address spy = address(new MockXStock("Wrapped S&P 500 xStock", "wSPYx", 18, deployer));
        address qqq = address(new MockXStock("Wrapped Nasdaq-100 xStock", "wQQQx", 18, deployer));
        address mu = address(new MockXStock("Wrapped Micron xStock", "wMUx", 18, deployer));
        address skhy = address(new MockXStock("Wrapped SK hynix xStock", "wSKHYx", 18, deployer));
        address spacex = address(new MockXStock("TEST Wrapped SpaceX", "wSPACEx", 18, deployer));
        address openai = address(new MockXStock("TEST Wrapped OpenAI", "wOPENAIx", 18, deployer));

        PositionManager posm = new PositionManager(
            manager, IAllowanceTransfer(permit2), 300_000, IPositionDescriptor(address(0)), IWETH9(whype)
        );
        StateView stateView = new StateView(manager);
        V4Quoter quoter = new V4Quoter(manager);
        SeedixRouter router = new SeedixRouter(manager);

        uint256 n = vm.getNonce(deployer);
        address vaultA = vm.computeCreateAddress(deployer, n + 3);
        address execA = vm.computeCreateAddress(deployer, n + 4);
        address distA = vm.computeCreateAddress(deployer, n + 5);
        (, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            C.HOOK_FLAGS,
            type(LaunchHook).creationCode,
            abi.encode(manager, vaultA, execA, distA, deployer)
        );

        address[] memory proposers = new address[](1);
        proposers[0] = deployer;
        address[] memory executors = new address[](1);
        executors[0] = deployer;
        TimelockController tl = new TimelockController(48 hours, proposers, executors, deployer);
        address guardian = vm.envOr("GUARDIAN", admin);
        SeedixRoles roles = new SeedixRoles(tl, admin, guardian);
        LaunchToken impl = new LaunchToken();
        address feeWallet = vm.envOr("FEE_WALLET", C.FEE_WALLET);
        FeeVault vault = new FeeVault(roles, feeWallet, deployer);
        BuybackExecutor executor =
            new BuybackExecutor(roles, Currency.wrap(whype), deployer, TESTNET_MIN_ROUTE_DEPTH, 0);
        KickbackDistributor distributor =
            new KickbackDistributor(roles, publisher, 1_000_000 ether, 10_000_000 ether, 1_000_000 ether, deployer, 0);
        require(address(vault) == vaultA && address(executor) == execA && address(distributor) == distA, "nonce");

        tl.grantRole(tl.PROPOSER_ROLE(), admin);
        tl.grantRole(tl.EXECUTOR_ROLE(), admin);
        tl.grantRole(tl.CANCELLER_ROLE(), admin);
        tl.grantRole(tl.PROPOSER_ROLE(), address(roles));
        tl.grantRole(tl.PROPOSER_ROLE(), address(vault));
        // When admin is the deployer, those grants are no-ops. Renouncing would strip the admin.
        if (admin != deployer) {
            tl.renounceRole(tl.PROPOSER_ROLE(), deployer);
            tl.renounceRole(tl.EXECUTOR_ROLE(), deployer);
            tl.renounceRole(tl.CANCELLER_ROLE(), deployer);
        }
        tl.renounceRole(tl.DEFAULT_ADMIN_ROLE(), deployer);

        LaunchHook hook =
            new LaunchHook{salt: salt}(manager, address(vault), address(executor), address(distributor), deployer);
        require(uint160(address(hook)) & ((1 << 14) - 1) == C.HOOK_FLAGS, "flags");

        address[] memory pairs = new address[](7);
        pairs[0] = whype;
        pairs[1] = usdc;
        pairs[2] = nvda;
        pairs[3] = spy;
        pairs[4] = qqq;
        pairs[5] = mu;
        pairs[6] = skhy;

        LiquidityLocker locker = new LiquidityLocker(manager, deployer);
        Launcher launcher = new Launcher(roles, manager, hook, locker, impl, executor, deployer, pairs);
        hook.setLauncher(address(launcher));
        hook.setLocker(address(locker));
        vault.setHook(hook);
        executor.wire(hook, address(launcher), address(locker));
        locker.wire(hook, address(launcher), address(executor));
        distributor.wire(hook, address(manager), address(locker), address(vault), address(executor));
        executor.grantKeeper(keeper);
        distributor.grantKeeper(keeper);

        address[] memory stockTokens = new address[](5);
        uint8[] memory stockCats = new uint8[](5);
        stockTokens[0] = nvda;
        stockTokens[1] = spy;
        stockTokens[2] = qqq;
        stockTokens[3] = mu;
        stockTokens[4] = skhy;
        for (uint256 i; i < 5; ++i) {
            stockCats[i] = launcher.CATEGORY_STOCK();
        }
        launcher.bootstrapCategories(stockTokens, stockCats);

        address[] memory seeded = new address[](7);
        seeded[0] = nvda;
        seeded[1] = spy;
        seeded[2] = qqq;
        seeded[3] = mu;
        seeded[4] = skhy;
        seeded[5] = spacex;
        seeded[6] = openai;
        console2.log("planned route pools", uint256(seeded.length));
        console2.log("planned whype per pool", TESTNET_MIN_ROUTE_DEPTH);
        console2.log("planned whype total", TESTNET_MIN_ROUTE_DEPTH * seeded.length);
        console2.log("mainnet min route depth", C.MAINNET_MIN_ROUTE_DEPTH);
        RouteSeeder seeder = new RouteSeeder();
        // These pools are WHYPE↔backing routes, not launch pairs. Launch pools are coin/WHYPE.
        // A shortfall is pulled from the deployer, capped at one depth. Cleared after the loop.
        IERC20(whype).approve(address(seeder), TESTNET_MIN_ROUTE_DEPTH);
        PoolKey[] memory stockRoutes = new PoolKey[](5);
        PoolKey[2] memory preipoRoutes;
        uint256 whypeSpent;
        for (uint256 i; i < seeded.length; ++i) {
            // The backing token funds both sides of the range, so it keeps a 4x buffer. WHYPE is one
            // side: send exactly one depth. Anything the position does not take returns here.
            MockXStock(seeded[i]).approve(address(seeder), TESTNET_MIN_ROUTE_DEPTH * 4);
            MockXStock(seeded[i]).transfer(address(seeder), TESTNET_MIN_ROUTE_DEPTH * 4);
            IERC20(whype).transfer(address(seeder), TESTNET_MIN_ROUTE_DEPTH);
            (PoolKey memory key, uint256 spent) = seeder.seed(manager, whype, seeded[i], TESTNET_MIN_ROUTE_DEPTH);
            whypeSpent += spent;
            console2.log("backing route", seeded[i], spent);
            if (i < 5) stockRoutes[i] = key;
            else preipoRoutes[i - 5] = key;
        }
        IERC20(whype).approve(address(seeder), 0);
        for (uint256 i; i < seeded.length; ++i) {
            MockXStock(seeded[i]).approve(address(seeder), 0);
        }
        console2.log("whype seed total", whypeSpent);
        if (whypeSpent > SEED_BUDGET) revert SeedBudget(whypeSpent, SEED_BUDGET);
        executor.bootstrapRoutes(stockRoutes);
        CoinMetadata meta = new CoinMetadata(launcher);
        console2.log("metadata", address(meta));
        console2.log("preipo unregistered", spacex);
        console2.log("preipo unregistered", openai);
        console2.log("timelock setPair wSPACEx status 1 category 2");
        console2.logBytes(abi.encodeCall(Launcher.setPair, (spacex, 1, 2)));
        console2.log("timelock setPair wOPENAIx status 1 category 2");
        console2.logBytes(abi.encodeCall(Launcher.setPair, (openai, 1, 2)));
        console2.log("timelock registerExternal wSPACEx currency0", Currency.unwrap(preipoRoutes[0].currency0));
        console2.log("timelock registerExternal wSPACEx currency1", Currency.unwrap(preipoRoutes[0].currency1));
        console2.log("timelock registerExternal wOPENAIx currency0", Currency.unwrap(preipoRoutes[1].currency0));
        console2.log("timelock registerExternal wOPENAIx currency1", Currency.unwrap(preipoRoutes[1].currency1));

        vm.stopBroadcast();
        routeSeeder = address(seeder);

        last = Result({
            deployer: deployer,
            admin: admin,
            timelock: address(tl),
            roles: address(roles),
            vault: address(vault),
            executor: address(executor),
            distributor: address(distributor),
            hook: address(hook),
            launcher: address(launcher),
            locker: address(locker)
        });

        console2.log("chain", block.chainid);
        console2.log("admin", admin);
        console2.log("guardian", roles.guardian());
        console2.log("poolManager", address(manager));
        console2.log("positionManager", address(posm));
        console2.log("stateView", address(stateView));
        console2.log("quoter", address(quoter));
        console2.log("router", address(router));
        console2.log("permit2", permit2);
        console2.log("hook", address(hook));
        console2.log("launcher", address(launcher));
        console2.log("vault", address(vault));
        console2.log("executor", address(executor));
        console2.log("distributor", address(distributor));
        console2.log("locker", address(locker));
        console2.log("keeper", keeper);
        console2.log("whype", whype);
        console2.log("poolManager hash");
        console2.logBytes32(address(manager).codehash);
        console2.log("hook hash");
        console2.logBytes32(address(hook).codehash);
    }

    struct MainnetRoles {
        address admin;
        address guardian;
        address feeWallet;
        address proposer;
        address publisher;
        address keeper;
    }

    /// @notice Mainnet roles must be distinct, and the fee wallet must not be the shared testnet key.
    function requireMainnetRoles(MainnetRoles memory roles_) public view {
        if (block.chainid != 99901) revert ForbiddenChain(block.chainid);
        _distinct(roles_.admin, roles_.guardian);
        _distinct(roles_.admin, roles_.feeWallet);
        _distinct(roles_.admin, roles_.proposer);
        _distinct(roles_.admin, roles_.publisher);
        _distinct(roles_.admin, roles_.keeper);
        _distinct(roles_.guardian, roles_.feeWallet);
        _distinct(roles_.guardian, roles_.proposer);
        _distinct(roles_.guardian, roles_.publisher);
        _distinct(roles_.guardian, roles_.keeper);
        _distinct(roles_.feeWallet, roles_.proposer);
        _distinct(roles_.feeWallet, roles_.publisher);
        _distinct(roles_.feeWallet, roles_.keeper);
        _distinct(roles_.proposer, roles_.publisher);
        _distinct(roles_.proposer, roles_.keeper);
        _distinct(roles_.publisher, roles_.keeper);
        if (roles_.feeWallet == C.FEE_WALLET) revert FeeWalletReuse(roles_.feeWallet);
    }

    struct CanonicalUniswap {
        address poolManager;
        address positionManager;
        address stateView;
        address quoter;
        address whype;
        address permit2;
    }

    /// @notice Mainnet deploy. Uses the canonical Uniswap v4 contracts passed in.
    ///         This function does not deploy a PoolManager, PositionManager, or mock tokens.
    function deployMainnet(uint256 pk, MainnetRoles memory roles_, CanonicalUniswap memory uni, address[] memory pairs)
        public
    {
        requireMainnetRoles(roles_);
        _requireCode(uni.poolManager);
        _requireCode(uni.positionManager);
        _requireCode(uni.stateView);
        _requireCode(uni.quoter);
        _requireCode(uni.whype);
        _requireCode(uni.permit2);
        if (pairs.length == 0) revert MissingCode(address(0));
        address deployer = vm.addr(pk);
        vm.startBroadcast(pk);
        IPoolManager manager = IPoolManager(uni.poolManager);
        uint256 n = vm.getNonce(deployer);
        address vaultA = vm.computeCreateAddress(deployer, n + 3);
        address execA = vm.computeCreateAddress(deployer, n + 4);
        address distA = vm.computeCreateAddress(deployer, n + 5);
        (, bytes32 salt) = HookMiner.find(
            CREATE2_DEPLOYER,
            C.HOOK_FLAGS,
            type(LaunchHook).creationCode,
            abi.encode(manager, vaultA, execA, distA, deployer)
        );
        address[] memory proposers = new address[](1);
        proposers[0] = roles_.proposer;
        address[] memory executors = new address[](1);
        executors[0] = roles_.proposer;
        TimelockController tl = new TimelockController(48 hours, proposers, executors, deployer);
        SeedixRoles seedixRoles = new SeedixRoles(tl, roles_.admin, roles_.guardian);
        new LaunchToken();
        FeeVault vault = new FeeVault(seedixRoles, roles_.feeWallet, deployer);
        BuybackExecutor executor =
            new BuybackExecutor(seedixRoles, Currency.wrap(uni.whype), deployer, C.MAINNET_MIN_ROUTE_DEPTH, 48 hours);
        KickbackDistributor distributor = new KickbackDistributor(
            seedixRoles, roles_.publisher, 1_000 ether, 5_000 ether, 100 ether, deployer, 48 hours
        );
        require(address(vault) == vaultA && address(executor) == execA && address(distributor) == distA, "nonce");
        new SeedixRouter(manager);
        LaunchHook hook =
            new LaunchHook{salt: salt}(manager, address(vault), address(executor), address(distributor), deployer);
        LiquidityLocker locker = new LiquidityLocker(manager, deployer);
        Launcher launcher =
            new Launcher(seedixRoles, manager, hook, locker, new LaunchToken(), executor, deployer, pairs);
        hook.setLauncher(address(launcher));
        hook.setLocker(address(locker));
        vault.setHook(hook);
        executor.wire(hook, address(launcher), address(locker));
        locker.wire(hook, address(launcher), address(executor));
        distributor.wire(hook, address(manager), address(locker), address(vault), address(executor));
        executor.grantKeeper(roles_.keeper);
        distributor.grantKeeper(roles_.keeper);
        vm.stopBroadcast();
        last = Result({
            deployer: deployer,
            admin: roles_.admin,
            timelock: address(tl),
            roles: address(seedixRoles),
            vault: address(vault),
            executor: address(executor),
            distributor: address(distributor),
            hook: address(hook),
            launcher: address(launcher),
            locker: address(locker)
        });
        console2.log("mainnet poolManager", uni.poolManager);
        console2.log("mainnet positionManager", uni.positionManager);
        console2.log("mainnet stateView", uni.stateView);
        console2.log("mainnet quoter", uni.quoter);
    }

    function _distinct(address a, address b) internal pure {
        if (a == address(0) || a == b) revert RolesCollide(a, b);
    }

    /// @dev Canonical code is required on 99801. Mocks exist only on local Anvil. Mainnet uses `deployMainnet`.
    function _canonicalOrMock(address admin) internal returns (address whype, address usdc, address permit2) {
        if (block.chainid == 31337) {
            permit2 = PERMIT2.code.length == 0 ? _deployPermit2(admin) : PERMIT2;
            whype = WHYPE_99801.code.length == 0
                ? address(new MockXStock("Wrapped HYPE", "WHYPE", 18, admin))
                : WHYPE_99801;
            usdc = USDC_99801.code.length == 0 ? address(new MockXStock("USD Coin", "USDC", 6, admin)) : USDC_99801;
            return (whype, usdc, permit2);
        }
        if (block.chainid != 99801) revert ForbiddenChain(block.chainid);
        _requireCode(CREATE2_DEPLOYER);
        _requireCode(WHYPE_99801);
        _requireCode(USDC_99801);
        _requireCode(PERMIT2);
        return (WHYPE_99801, USDC_99801, PERMIT2);
    }

    function _requireCode(address target) internal view {
        if (target.code.length == 0) revert MissingCode(target);
    }

    /// @dev Permit2's bytecode is solc 0.8.17. The stand-in exists only on local Anvil.
    function _deployPermit2(address issuer) internal returns (address) {
        if (block.chainid != 31337) revert Permit2Missing();
        return address(new MockXStock("Permit2 stand-in", "P2", 18, issuer));
    }
}
