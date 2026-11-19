// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Fixture} from "../utils/Fixture.sol";
import {SeedixConstants as C} from "../../src/libraries/SeedixConstants.sol";
import {LaunchToken} from "../../src/token/LaunchToken.sol";
import {EnforcedOptionParam} from "@layerzerolabs/oapp-evm/contracts/oapp/interfaces/IOAppOptionsType3.sol";
import {MessagingFee, SendParam} from "@layerzerolabs/oft-evm/contracts/interfaces/IOFT.sol";
import {ZroCoinAdapter} from "../../src/zro/ZroCoinAdapter.sol";
import {ZroGraduation} from "../../src/zro/ZroGraduation.sol";
import {ZroRemoteOFT} from "../../src/zro/ZroRemoteOFT.sol";
import {ZroWeightTracker} from "../../src/zro/ZroWeightTracker.sol";
import {TestLzEndpoint} from "./TestLzEndpoint.sol";

contract CoinAllow {
    mapping(address => bool) public isLaunchedCoin;

    function allow(address coin) external {
        isLaunchedCoin[coin] = true;
    }
}

contract ZroGraduateTest is Fixture {
    function test_adapterLocksTheCoinAndAdminsSetPeers() public {
        LaunchToken impl = new LaunchToken();
        LaunchToken coin = LaunchToken(Clones.clone(address(impl)));
        coin.initialize("Coin", "COIN", address(this), C.SUPPLY, address(0), 0);
        CoinAllow list = new CoinAllow();
        list.allow(address(coin));

        TestLzEndpoint endpoint = new TestLzEndpoint(1, 0.01 ether);
        ZroWeightTracker tracker = new ZroWeightTracker(address(this), address(0), address(0), address(0));
        ZroGraduation grad =
            new ZroGraduation(address(endpoint), address(this), address(d.timelock), address(tracker), address(list));
        tracker.setTimelock(address(d.timelock));
        vm.prank(address(d.timelock));
        tracker.setExcluder(address(grad));

        ZroCoinAdapter adapter = ZroCoinAdapter(grad.graduate(address(coin)));
        ZroRemoteOFT remote =
            new ZroRemoteOFT("Remote", "REM", address(endpoint), address(this), address(d.timelock), 60);
        assertEq(adapter.token(), address(coin));
        assertTrue(tracker.excludedFrom(address(coin), address(adapter)));
        assertEq(grad.adapterOf(address(coin)), address(adapter));

        vm.expectRevert(ZroGraduation.AlreadyGraduated.selector);
        grad.graduate(address(coin));
        vm.prank(address(0xBEEF));
        vm.expectRevert(ZroGraduation.NotAdmin.selector);
        grad.graduate(address(0x1234));

        vm.prank(address(0xBEEF));
        vm.expectRevert(ZroCoinAdapter.NotTimelock.selector);
        adapter.setPeer(2, bytes32(uint256(uint160(address(remote)))));
        vm.startPrank(address(d.timelock));
        adapter.setPeer(2, bytes32(uint256(uint160(address(remote)))));
        remote.setPeer(1, bytes32(uint256(uint160(address(adapter)))));
        EnforcedOptionParam[] memory opts = new EnforcedOptionParam[](1);
        opts[0] = EnforcedOptionParam({eid: 2, msgType: 1, options: hex"0003"});
        adapter.setEnforcedOptions(opts);
        vm.stopPrank();

        coin.approve(address(adapter), 10 ether);
        SendParam memory param = SendParam({
            dstEid: 2,
            to: bytes32(uint256(uint160(address(this)))),
            amountLD: 10 ether,
            minAmountLD: 0,
            extraOptions: "",
            composeMsg: "",
            oftCmd: ""
        });
        MessagingFee memory fee = adapter.quoteSend(param, false);
        adapter.send{value: fee.nativeFee}(param, fee, address(this));
        assertEq(coin.balanceOf(address(adapter)), 10 ether);
        endpoint.deliverLast();
        assertEq(remote.totalSupply(), coin.balanceOf(address(adapter)));
        assertEq(remote.balanceOf(address(this)), 10 ether);
    }
}
