pragma solidity ^0.8.24;

import {FlatstockLock} from "../src/FlatstockLock.sol";
import {FlatstockEIP712} from "../src/FlatstockEIP712.sol";
import {FlatstockRouter, IMetaSwapRouter} from "../src/FlatstockRouter.sol";
import {FlatstockVotes} from "../src/FlatstockVotes.sol";

interface VmMeta {
    function addr(uint256 privateKey) external returns (address);
    function expectRevert(bytes4 selector) external;
    function prank(address sender) external;
    function warp(uint256 newTimestamp) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
}

contract MockMetaToken {
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

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
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

contract MockPermitToken is MockMetaToken {
    mapping(address => uint256) public nonces;
    bytes32 public constant DOMAIN_SEPARATOR = keccak256("mock permit domain");

    function permit(address owner, address spender, uint256 value, uint256, uint8, bytes32, bytes32) external {
        allowance[owner][spender] = value;
        nonces[owner] += 1;
    }
}

contract MockMetaSwapRouter {
    function exactInputSingle(IMetaSwapRouter.ExactInputSingleParams calldata params)
        external
        returns (uint256 amountOut)
    {
        MockMetaToken(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        amountOut = params.amountIn * 2;
        MockMetaToken(params.tokenOut).mint(params.recipient, amountOut);
    }
}

contract FlatstockMetaTest {
    VmMeta private constant vm = VmMeta(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ALICE_KEY = 0xA11CE;
    uint256 private constant BOB_KEY = 0xB0B;
    uint256 private constant CAROL_KEY = 0xCA11;
    address private alice = vm.addr(ALICE_KEY);
    address private bob = vm.addr(BOB_KEY);
    address private carol = vm.addr(CAROL_KEY);
    MockMetaToken private wif = new MockMetaToken();
    FlatstockLock private lock = new FlatstockLock(address(wif), 10 ether);
    FlatstockVotes private votes = new FlatstockVotes(address(wif), address(lock));

    function setUp() public {
        wif.mint(alice, 20 ether);
        wif.mint(bob, 3 ether);
        wif.mint(carol, 3 ether);
        vm.prank(alice);
        wif.approve(address(lock), type(uint256).max);
        vm.prank(alice);
        lock.lock(10 ether);
        vm.prank(alice);
        wif.approve(address(votes), type(uint256).max);
        vm.prank(bob);
        wif.approve(address(votes), type(uint256).max);
        vm.prank(carol);
        wif.approve(address(votes), type(uint256).max);
    }

    function _voteDigest(address voter, uint256 roundId, uint8 assetIndex, uint256 nonce, uint256 deadline)
        private
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(votes.VOTE_TYPEHASH(), voter, roundId, assetIndex, nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", votes.DOMAIN_SEPARATOR(), structHash));
    }

    function testRelayedVoteRequiresExactSignatureAndNonce() public {
        votes.openRound(1, 3, uint64(block.timestamp + 1 days));
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ALICE_KEY, _voteDigest(alice, 1, 0, 0, deadline));
        bytes memory signature = abi.encodePacked(r, s, v);

        votes.voteBySig(alice, 1, 0, 0, deadline, signature);
        require(votes.votesFor(1, 0) == 1, "relayed vote not counted");
        require(wif.totalSupply() == 25 ether, "relayed vote did not burn one WIF");

        vm.expectRevert(FlatstockVotes.InvalidNonce.selector);
        votes.voteBySig(alice, 1, 0, 0, deadline, signature);
    }

    function testRelayedVoteRejectsTamperingAndUnlockedWallet() public {
        votes.openRound(2, 3, uint64(block.timestamp + 1 days));
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ALICE_KEY, _voteDigest(alice, 2, 0, 0, deadline));
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert(FlatstockEIP712.InvalidSignature.selector);
        votes.voteBySig(alice, 2, 1, 0, deadline, signature);

        (v, r, s) = vm.sign(BOB_KEY, _voteDigest(bob, 2, 1, 0, deadline));
        signature = abi.encodePacked(r, s, v);
        vm.expectRevert(FlatstockVotes.NotLocked.selector);
        votes.voteBySig(bob, 2, 1, 0, deadline, signature);
    }

    function testCloseStoresCorrectWeightsForZeroOneAndManyVotes() public {
        votes.openRound(3, 3, uint64(block.timestamp + 1 days));
        vm.warp(block.timestamp + 1 days);
        votes.closeRound(3);
        require(votes.finalWeightBps(3, 0) == 3334, "zero vote close first weight");
        require(votes.finalWeightBps(3, 1) == 3333, "zero vote close second weight");
        require(votes.finalWeightBps(3, 2) == 3333, "zero vote close third weight");

        votes.openRound(4, 3, uint64(block.timestamp + 1 days));
        vm.prank(bob);
        votes.vote(4, 1);
        vm.warp(block.timestamp + 1 days);
        votes.closeRound(4);
        require(votes.finalWeightBps(4, 0) == 2500, "one vote close first weight");
        require(votes.finalWeightBps(4, 1) == 5000, "one vote close second weight");
        require(votes.finalWeightBps(4, 2) == 2500, "one vote close third weight");

        votes.openRound(5, 3, uint64(block.timestamp + 1 days));
        vm.prank(alice);
        votes.vote(5, 0);
        vm.prank(bob);
        votes.vote(5, 0);
        vm.prank(carol);
        votes.vote(5, 1);
        vm.warp(block.timestamp + 1 days);
        votes.closeRound(5);
        require(votes.finalWeightBps(5, 0) == 5000, "many vote close first weight");
        require(votes.finalWeightBps(5, 1) == 3333, "many vote close second weight");
        require(votes.finalWeightBps(5, 2) == 1667, "many vote close third weight");
    }
}

contract FlatstockRouterTest {
    VmMeta private constant vm = VmMeta(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ALICE_KEY = 0xA11CE;
    address private alice = vm.addr(ALICE_KEY);
    MockMetaToken private wif = new MockMetaToken();
    MockPermitToken private usdg = new MockPermitToken();
    MockMetaToken private stockA = new MockMetaToken();
    MockMetaToken private stockB = new MockMetaToken();
    FlatstockLock private lock = new FlatstockLock(address(wif), 10 ether);
    MockMetaSwapRouter private swap = new MockMetaSwapRouter();
    FlatstockRouter private router = new FlatstockRouter(address(usdg), address(lock), address(swap));

    function setUp() public {
        wif.mint(alice, 20 ether);
        vm.prank(alice);
        wif.approve(address(lock), type(uint256).max);
        vm.prank(alice);
        lock.lock(10 ether);
    }

    function _buyDigest(
        address user,
        FlatstockRouter.Leg[] memory legs,
        uint256 amountIn,
        uint256 nonce,
        uint256 deadline
    ) private view returns (bytes32) {
        bytes32 legsHash = keccak256(abi.encode(legs));
        bytes32 structHash = keccak256(abi.encode(router.BUY_TYPEHASH(), user, legsHash, amountIn, nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", router.DOMAIN_SEPARATOR(), structHash));
    }

    function testExactRelayedBuyUsesPermitAndReplayIsRejected() public {
        usdg.mint(alice, 2 ether);
        FlatstockRouter.Leg[] memory legs = new FlatstockRouter.Leg[](2);
        legs[0] = FlatstockRouter.Leg(address(stockA), 500, 0.5 ether, 1 ether, 0);
        legs[1] = FlatstockRouter.Leg(address(stockB), 500, 0.5 ether, 1 ether, 0);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ALICE_KEY, _buyDigest(alice, legs, 1 ether, 0, deadline));
        FlatstockRouter.PermitData memory permit = FlatstockRouter.PermitData(2 ether, deadline, v, r, s);

        router.buyMixBySig(alice, legs, 1 ether, 0, deadline, permit, abi.encodePacked(r, s, v));
        require(stockA.balanceOf(alice) == 1 ether, "first stock not delivered");
        require(stockB.balanceOf(alice) == 1 ether, "second stock not delivered");
        require(router.buyNonces(alice) == 1, "buy nonce not consumed");

        vm.expectRevert(FlatstockRouter.InvalidNonce.selector);
        router.buyMixBySig(alice, legs, 1 ether, 0, deadline, permit, abi.encodePacked(r, s, v));
    }

    function testBuySignatureCommitsToEveryLeg() public {
        FlatstockRouter.Leg[] memory signedLegs = new FlatstockRouter.Leg[](1);
        signedLegs[0] = FlatstockRouter.Leg(address(stockA), 500, 1 ether, 2 ether, 0);
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ALICE_KEY, _buyDigest(alice, signedLegs, 1 ether, 0, deadline));

        FlatstockRouter.Leg[] memory tamperedLegs = new FlatstockRouter.Leg[](1);
        tamperedLegs[0] = FlatstockRouter.Leg(address(stockB), 500, 1 ether, 2 ether, 0);
        vm.expectRevert(FlatstockEIP712.InvalidSignature.selector);
        router.buyMixBySig(
            alice,
            tamperedLegs,
            1 ether,
            0,
            deadline,
            FlatstockRouter.PermitData(0, 0, 0, 0, 0),
            abi.encodePacked(r, s, v)
        );
    }

    function testDirectWalletBuyHasNoWifGasPath() public {
        usdg.mint(alice, 1 ether);
        vm.prank(alice);
        usdg.approve(address(router), 1 ether);
        vm.prank(alice);
        router.buyUniswap(address(usdg), address(stockA), 500, 1 ether, 2 ether, 0);
        require(stockA.balanceOf(alice) == 2 ether, "direct buy not delivered");
        require(wif.balanceOf(alice) == 10 ether, "direct buy touched WIF");
    }
}
