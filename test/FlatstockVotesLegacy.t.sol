pragma solidity ^0.8.24;

import {FlatstockVotesLegacy} from "../src/FlatstockVotesLegacy.sol";

interface VmVote {
    function addr(uint256 privateKey) external returns (address);
    function expectRevert(bytes4 selector) external;
    function prank(address sender) external;
    function warp(uint256 newTimestamp) external;
}

contract MockWifVoteToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function burn(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
    }
}

contract FlatstockVotesLegacyTest {
    VmVote private constant vm = VmVote(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ALICE_KEY = 0xA11CE;
    uint256 private constant BOB_KEY = 0xB0B;
    uint256 private constant CAROL_KEY = 0xCA11;

    address private alice = vm.addr(ALICE_KEY);
    address private bob = vm.addr(BOB_KEY);
    address private carol = vm.addr(CAROL_KEY);
    MockWifVoteToken private wif = new MockWifVoteToken();
    FlatstockVotesLegacy private votes = new FlatstockVotesLegacy(address(wif));

    function setUp() public {
        wif.mint(alice, 3 ether);
        wif.mint(bob, 2 ether);
        wif.mint(carol, 2 ether);
        vm.prank(alice);
        wif.approve(address(votes), type(uint256).max);
        vm.prank(bob);
        wif.approve(address(votes), type(uint256).max);
        vm.prank(carol);
        wif.approve(address(votes), type(uint256).max);
    }

    function testVoteCostsOneWifBurnsAndDoubleVoteReverts() public {
        votes.openRound(1, 3, uint64(block.timestamp + 1 days));

        vm.prank(alice);
        votes.vote(1, 0);

        require(wif.balanceOf(alice) == 2 ether, "vote did not cost one WIF");
        require(wif.totalSupply() == 6 ether, "WIF was not burned");
        require(votes.votesFor(1, 0) == 1, "vote not counted");

        vm.expectRevert(FlatstockVotesLegacy.AlreadyVoted.selector);
        vm.prank(alice);
        votes.vote(1, 1);
    }

    function testBlendCapsAndWeightsFreezeAtClose() public {
        votes.openRound(2, 3, uint64(block.timestamp + 1 days), 5_000);
        require(votes.latestRoundId() == 2, "latest round id mismatch");

        vm.prank(alice);
        votes.vote(2, 0);
        vm.prank(bob);
        votes.vote(2, 0);
        vm.warp(block.timestamp + 1 days);
        votes.closeRound(2);

        require(votes.voteShareBps(2) == 5_000, "blend ratio mismatch");
        require(votes.weightBps(2, 0) == 5_000, "cap mismatch");
        require(votes.weightBps(2, 1) == 2_500, "first redistribution mismatch");
        require(votes.weightBps(2, 2) == 2_500, "second redistribution mismatch");
        require(votes.finalWeightBps(2, 0) == 5_000, "final weight was not stored");

        vm.expectRevert(FlatstockVotesLegacy.RoundNotOpen.selector);
        vm.prank(alice);
        votes.vote(2, 2);
    }

    function testNoVotesUseEqualWeightsAndBlendRatioIsParameter() public {
        votes.openRound(3, 3, uint64(block.timestamp + 1 days), 5_000);

        require(votes.voteShareBps(3) == 5_000, "blend ratio was not stored");
        require(votes.weightBps(3, 0) == 3_334, "equal first weight mismatch");
        require(votes.weightBps(3, 1) == 3_333, "equal second weight mismatch");
        require(votes.weightBps(3, 2) == 3_333, "equal third weight mismatch");
        require(
            votes.weightBps(3, 0) + votes.weightBps(3, 1) + votes.weightBps(3, 2) == 10_000,
            "zero vote weights do not sum to 100%"
        );

        vm.warp(block.timestamp + 1 days);
        votes.closeRound(3);
        require(votes.finalWeightBps(3, 0) == 3_334, "zero vote final first mismatch");
        require(votes.finalWeightBps(3, 1) == 3_333, "zero vote final second mismatch");
        require(votes.finalWeightBps(3, 2) == 3_333, "zero vote final third mismatch");
    }

    function testOneNvdaVoteProducesCappedRoundThreeMix() public {
        votes.openRound(4, 3, uint64(block.timestamp + 1 days), 5_000);

        vm.prank(bob);
        votes.vote(4, 1);
        vm.warp(block.timestamp + 1 days);
        votes.closeRound(4);

        require(votes.finalWeightBps(4, 0) == 2_500, "AAPL one-vote final mismatch");
        require(votes.finalWeightBps(4, 1) == 5_000, "NVDA one-vote final mismatch");
        require(votes.finalWeightBps(4, 2) == 2_500, "MSFT one-vote final mismatch");
    }

    function testManyVotesBlendSharesAndCapAtFiftyPercent() public {
        votes.openRound(5, 3, uint64(block.timestamp + 1 days), 5_000);

        vm.prank(alice);
        votes.vote(5, 0);
        vm.prank(bob);
        votes.vote(5, 0);
        vm.prank(carol);
        votes.vote(5, 1);

        require(votes.weightBps(5, 0) == 5_000, "many vote first weight mismatch");
        require(votes.weightBps(5, 1) == 3_333, "many vote second weight mismatch");
        require(votes.weightBps(5, 2) == 1_667, "many vote third weight mismatch");
        require(
            votes.weightBps(5, 0) + votes.weightBps(5, 1) + votes.weightBps(5, 2) == 10_000,
            "many vote weights do not sum to 100%"
        );

        vm.warp(block.timestamp + 1 days);
        votes.closeRound(5);
        require(votes.finalWeightBps(5, 0) == 5_000, "many vote final first mismatch");
        require(votes.finalWeightBps(5, 1) == 3_333, "many vote final second mismatch");
        require(votes.finalWeightBps(5, 2) == 1_667, "many vote final third mismatch");
    }
}
