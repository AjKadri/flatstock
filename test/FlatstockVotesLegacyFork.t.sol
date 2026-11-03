pragma solidity ^0.8.24;

import {FlatstockVotesLegacy} from "../src/FlatstockVotesLegacy.sol";

interface VmWifFork {
    function getChainId() external returns (uint256);
    function prank(address sender) external;
    function warp(uint256 newTimestamp) external;
}

interface WifForkToken {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

contract FlatstockVotesLegacyForkTest {
    VmWifFork private constant vm = VmWifFork(address(uint160(uint256(keccak256("hevm cheat code")))));
    WifForkToken private constant wif = WifForkToken(0x5173b8eA6923c2d40267890D45C46a3480954773);
    address private constant voter = 0x3554121694a2472300f079Afa4B1fC7F9aAFac01;
    FlatstockVotesLegacy private votes = new FlatstockVotesLegacy(address(wif));

    function setUp() public {
        if (vm.getChainId() != 4663) return;
        vm.prank(voter);
        wif.approve(address(votes), 2 ether);
    }

    function testRealWifTransfersAndBurnsOnFork() public {
        if (vm.getChainId() != 4663) return;
        uint256 balanceBefore = wif.balanceOf(voter);
        uint256 supplyBefore = wif.totalSupply();
        votes.openRound(1, 3, uint64(block.timestamp + 1 days));

        vm.prank(voter);
        votes.vote(1, 0);

        require(wif.balanceOf(voter) == balanceBefore - 1 ether, "fork transfer mismatch");
        require(wif.totalSupply() == supplyBefore - 1 ether, "fork burn mismatch");
    }
}
