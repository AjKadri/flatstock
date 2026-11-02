pragma solidity ^0.8.24;

import {FlatIndexVotes} from "../src/FlatIndexVotes.sol";

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

contract FlatIndexVotesTest {
    VmVote private constant vm = VmVote(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ALICE_KEY = 0xA11CE;
    uint256 private constant BOB_KEY = 0xB0B;

    address private alice = vm.addr(ALICE_KEY);
    address private bob = vm.addr(BOB_KEY);
    MockWifVoteToken private wif = new MockWifVoteToken();
    FlatIndexVotes private votes = new FlatIndexVotes(address(wif));

    function setUp() public {
        wif.mint(alice, 3 ether);
        wif.mint(bob, 2 ether);
        vm.prank(alice);
        wif.approve(address(votes), type(uint256).max);
        vm.prank(bob);
        wif.approve(address(votes), type(uint256).max);
    }

    function testVoteCostsOneWifBurnsAndDoubleVoteReverts() public {
        votes.openRound(1, 3, uint64(block.timestamp + 1 days));

        vm.prank(alice);
        votes.vote(1, 0);

        require(wif.balanceOf(alice) == 2 ether, "vote did not cost one WIF");
        require(wif.totalSupply() == 4 ether, "WIF was not burned");
        require(votes.votesFor(1, 0) == 1, "vote not counted");

        vm.expectRevert(FlatIndexVotes.AlreadyVoted.selector);
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

        vm.expectRevert(FlatIndexVotes.RoundNotOpen.selector);
        vm.prank(alice);
        votes.vote(2, 2);
    }

    function testNoVotesUseEqualWeightsAndBlendRatioIsParameter() public {
        votes.openRound(3, 3, uint64(block.timestamp + 1 days), 0);

        require(votes.voteShareBps(3) == 0, "zero vote blend was not stored");
        require(votes.weightBps(3, 0) == 3_334, "equal first weight mismatch");
        require(votes.weightBps(3, 1) == 3_333, "equal second weight mismatch");
        require(votes.weightBps(3, 2) == 3_333, "equal third weight mismatch");
    }

    function testOneNvdaVoteProducesCappedRoundThreeMix() public {
        votes.openRound(4, 3, uint64(block.timestamp + 1 days), 5_000);

        vm.prank(bob);
        votes.vote(4, 1);
        vm.warp(block.timestamp + 1 days);
        votes.closeRound(4);

        require(votes.weightBps(4, 0) == 2_500, "AAPL round-three mix mismatch");
        require(votes.weightBps(4, 1) == 5_000, "NVDA round-three mix mismatch");
        require(votes.weightBps(4, 2) == 2_500, "MSFT round-three mix mismatch");
    }
}
