// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager as IManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {SeedixConstants as C} from "../../src/libraries/SeedixConstants.sol";
import {MockXStock} from "../../src/token/MockXStock.sol";
import {SeedixRouter} from "../../src/router/SeedixRouter.sol";
import {SeedixDeployer} from "../../src/deploy/SeedixDeployer.sol";
import {Launcher} from "../../src/launch/Launcher.sol";

contract Fixture is Test {
    using StateLibrary for IManager;
    PoolManager internal pm;
    SeedixRouter internal router;
    MockXStock internal whype;
    SeedixDeployer.Deployed internal d;

    address internal admin = address(0xA11CE);
    address internal publisher = address(0xB0B);
    address internal creator = address(0xC0FFEE);

    function setUp() public virtual {
        pm = new PoolManager(address(0));
        router = new SeedixRouter(IPoolManager(address(pm)));
        whype = new MockXStock("Wrapped HYPE", "WHYPE", 18, address(this));
        address[] memory pairs = new address[](1);
        pairs[0] = address(whype);
        d = new SeedixDeployer()
            .deploy(
                SeedixDeployer.Params({
                    admin: admin,
                    poolManager: pm,
                    timelockDelay: 48 hours,
                    feeWallet: C.FEE_WALLET,
                    publisher: publisher,
                    whype: Currency.wrap(address(whype)),
                    roundCap: 1_000_000 ether,
                    hourlyCap: 10_000_000 ether,
                    pairs: pairs
                })
            );
        whype.approve(address(router), type(uint256).max);
    }

    function _params(address pair, uint8 mode, uint16 teamBps, address team)
        internal
        view
        returns (Launcher.LaunchParams memory)
    {
        return Launcher.LaunchParams({
            name: "Seed Coin",
            symbol: "SEED",
            pair: pair,
            mode: mode,
            feeRecipient: creator,
            teamWallet: team,
            teamBps: teamBps,
            startMcapInPair: 20_000 ether
        });
    }

    function _launch(uint8 mode) internal returns (address coin, PoolId id) {
        (coin, id) = d.launcher.launch(_params(address(whype), mode, 0, address(0)));
    }

    function _spot(PoolId id) internal view returns (int24 tick) {
        (, tick,,) = IManager(address(pm)).getSlot0(id);
    }

    function _key(PoolId id) internal view returns (PoolKey memory) {
        return d.hook.keyOf(id);
    }

    function _buy(PoolId id, uint256 amount) internal returns (int128 coinDelta) {
        (,, bool coinIsToken0,,,,) = d.hook.config(id);
        BalanceDelta delta = router.swap(_key(id), !coinIsToken0, -int256(amount), 0);
        coinDelta = coinIsToken0 ? delta.amount0() : delta.amount1();
    }

    function _sell(PoolId id, uint256 amount) internal returns (int128 pairDelta) {
        (,, bool coinIsToken0,,,,) = d.hook.config(id);
        BalanceDelta delta = router.swap(_key(id), coinIsToken0, -int256(amount), 0);
        pairDelta = coinIsToken0 ? delta.amount1() : delta.amount0();
    }

    function _buyExactOut(PoolId id, uint256 coinOut) internal returns (int128 pairDelta) {
        (,, bool coinIsToken0,,,,) = d.hook.config(id);
        BalanceDelta delta = router.swap(_key(id), !coinIsToken0, int256(coinOut), 0);
        pairDelta = coinIsToken0 ? delta.amount1() : delta.amount0();
    }
}
