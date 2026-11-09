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
import {SeedixConstants as C} from "../src/libraries/SeedixConstants.sol";
import {HookMiner} from "../src/libraries/HookMiner.sol";
import {MockXStock} from "../src/token/MockXStock.sol";
import {LaunchToken} from "../src/token/LaunchToken.sol";
import {LaunchHook} from "../src/hook/LaunchHook.sol";
import {LiquidityLocker} from "../src/launch/LiquidityLocker.sol";
import {Launcher} from "../src/launch/Launcher.sol";
import {FeeVault} from "../src/vault/FeeVault.sol";
import {BuybackExecutor} from "../src/buyback/BuybackExecutor.sol";
import {KickbackDistributor} from "../src/kickback/KickbackDistributor.sol";
import {SeedixRoles} from "../src/access/SeedixRoles.sol";
import {SeedixRouter} from "../src/router/SeedixRouter.sol";

/// @notice Testnet deploy. Refuses every chain except 99801 and local Anvil.
///         Do not pass --broadcast against a public RPC.
contract DeploySeedix is Script {
    error ForbiddenChain(uint256 chainId);
    error Permit2Missing();

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

    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    /// @dev `new {salt}` in a Forge script is CREATE2 from the Arachnid deployer, not the EOA.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant WHYPE_99801 = 0xCD57F65c2B0e5881CFC2E609F7CD53b746E1F234;
    address internal constant USDC_99801 = 0x7D29d8047B905000459c0E80c34a26CeedcB47b2;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address admin = vm.envOr("ADMIN", vm.addr(pk));
        address publisher = vm.envOr("KICKBACK_PUBLISHER", admin);
        deploy(pk, admin, publisher);
    }

    /// @dev `admin` receives the admin, guardian, proposer, and executor roles. The broadcasting key keeps none.
    function deploy(uint256 pk, address admin, address publisher) public {
        if (block.chainid != 99801 && block.chainid != 31337) revert ForbiddenChain(block.chainid);
        address deployer = vm.addr(pk);
        if (admin == address(0)) admin = deployer;
        if (publisher == address(0)) publisher = admin;

        vm.startBroadcast(pk);

        address permit2 = PERMIT2.code.length == 0 ? _deployPermit2(admin) : PERMIT2;
        IPoolManager manager = IPoolManager(address(new PoolManager(address(0))));
        address whype =
            WHYPE_99801.code.length == 0 ? address(new MockXStock("Wrapped HYPE", "WHYPE", 18, admin)) : WHYPE_99801;
        address usdc = USDC_99801.code.length == 0 ? address(new MockXStock("USD Coin", "USDC", 6, admin)) : USDC_99801;

        address nvda = address(new MockXStock("Wrapped NVIDIA xStock", "wNVDAx", 18, admin));
        address spy = address(new MockXStock("Wrapped S&P 500 xStock", "wSPYx", 18, admin));
        address qqq = address(new MockXStock("Wrapped Nasdaq-100 xStock", "wQQQx", 18, admin));
        address mu = address(new MockXStock("Wrapped Micron xStock", "wMUx", 18, admin));
        address skhy = address(new MockXStock("Wrapped SK hynix xStock", "wSKHYx", 18, admin));

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
        SeedixRoles roles = new SeedixRoles(tl, admin);
        LaunchToken impl = new LaunchToken();
        FeeVault vault = new FeeVault(roles, C.FEE_WALLET, deployer);
        BuybackExecutor executor = new BuybackExecutor(roles, Currency.wrap(whype), deployer);
        KickbackDistributor distributor =
            new KickbackDistributor(roles, publisher, 1_000_000 ether, 10_000_000 ether, deployer);
        require(address(vault) == vaultA && address(executor) == execA && address(distributor) == distA, "nonce");

        tl.grantRole(tl.PROPOSER_ROLE(), admin);
        tl.grantRole(tl.EXECUTOR_ROLE(), admin);
        tl.grantRole(tl.PROPOSER_ROLE(), address(roles));
        tl.grantRole(tl.PROPOSER_ROLE(), address(vault));
        tl.renounceRole(tl.PROPOSER_ROLE(), deployer);
        tl.renounceRole(tl.EXECUTOR_ROLE(), deployer);
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
        Launcher launcher = new Launcher(roles, manager, hook, locker, impl, executor, pairs);
        hook.setLauncher(address(launcher));
        hook.setLocker(address(locker));
        vault.setHook(hook);
        executor.wire(hook, address(launcher));
        locker.wire(hook, address(launcher), address(executor));
        distributor.wire(hook, address(manager), address(locker), address(vault), address(executor));

        vm.stopBroadcast();

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
        console2.log("whype", whype);
        console2.log("poolManager hash");
        console2.logBytes32(address(manager).codehash);
        console2.log("hook hash");
        console2.logBytes32(address(hook).codehash);
    }

    /// @dev Permit2's bytecode is solc 0.8.17. The stand-in exists only on local Anvil.
    ///      On 99801 a missing canonical Permit2 must stop the deploy.
    function _deployPermit2(address issuer) internal returns (address) {
        if (block.chainid != 31337) revert Permit2Missing();
        return address(new MockXStock("Permit2 stand-in", "P2", 18, issuer));
    }
}
