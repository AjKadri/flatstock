pragma solidity ^0.8.24;

import {M1RelayerDelegate} from "../src/M1RelayerDelegate.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function etch(address who, bytes calldata code) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function expectRevert(bytes4 selector) external;
}

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
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
}

contract MockRouter {
    MockToken public immutable sellToken;
    MockToken public immutable buyToken;

    constructor(MockToken sellToken_, MockToken buyToken_) {
        sellToken = sellToken_;
        buyToken = buyToken_;
    }

    function swap(uint256 amountIn) external returns (uint256 amountOut) {
        sellToken.transferFrom(msg.sender, address(this), amountIn);
        buyToken.mint(msg.sender, amountIn * 2);
        return amountIn * 2;
    }
}

contract M1RelayerDelegateTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant USER_KEY = 0xA11CE;
    address private user = vm.addr(USER_KEY);
    address private relayer = address(0xBEEF);

    MockToken private sellToken = new MockToken();
    MockToken private buyToken = new MockToken();
    MockRouter private router = new MockRouter(sellToken, buyToken);
    M1RelayerDelegate private implementation = new M1RelayerDelegate(relayer);

    function setUp() public {
        vm.etch(user, address(implementation).code);
        sellToken.mint(user, 10 ether);
    }

    function testRelayerExecuteUsesDelegatedUserAsTokenOwner() public {
        vm.prank(relayer);
        M1RelayerDelegate(user)
            .execute(address(sellToken), 0, abi.encodeCall(MockToken.approve, (address(router), 3 ether)));

        require(sellToken.allowance(user, address(router)) == 3 ether, "owner mismatch");
    }

    function testWeeklyLimitAndRevocation() public {
        uint256 expiresAt = block.timestamp + 30 days;
        bytes memory configSignature =
            _signConfig(address(router), address(sellToken), address(buyToken), 5 ether, expiresAt, 0);

        vm.prank(relayer);
        M1RelayerDelegate(user)
            .configurePolicy(
                address(router), address(sellToken), address(buyToken), 5 ether, expiresAt, configSignature
            );

        vm.prank(relayer);
        M1RelayerDelegate(user)
            .executeBuy(
                address(router),
                address(sellToken),
                address(buyToken),
                3 ether,
                abi.encodeCall(MockRouter.swap, (3 ether))
            );
        require(buyToken.balanceOf(user) == 6 ether, "buy failed");

        vm.expectRevert(M1RelayerDelegate.WeeklyLimitExceeded.selector);
        vm.prank(relayer);
        M1RelayerDelegate(user)
            .executeBuy(
                address(router),
                address(sellToken),
                address(buyToken),
                3 ether,
                abi.encodeCall(MockRouter.swap, (3 ether))
            );

        bytes memory revokeSignature = _signRevoke(1);
        vm.prank(relayer);
        M1RelayerDelegate(user).revokePolicy(revokeSignature);

        vm.expectRevert(M1RelayerDelegate.PolicyInactive.selector);
        vm.prank(relayer);
        M1RelayerDelegate(user)
            .executeBuy(
                address(router),
                address(sellToken),
                address(buyToken),
                1 ether,
                abi.encodeCall(MockRouter.swap, (1 ether))
            );
    }

    function _signConfig(
        address router_,
        address sellToken_,
        address buyToken_,
        uint256 weeklyLimit,
        uint256 expiresAt,
        uint256 nonce
    ) private returns (bytes memory) {
        bytes32 domainTypeHash = keccak256(
            "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
        );
        bytes32 configTypeHash = keccak256(
            "Configure(address router,address sellToken,address buyToken,uint256 weeklyLimit,uint256 expiresAt,uint256 nonce)"
        );
        bytes32 domain =
            keccak256(abi.encode(domainTypeHash, keccak256("M1 Relayer Policy"), keccak256("1"), block.chainid, user));
        bytes32 structHash =
            keccak256(abi.encode(configTypeHash, router_, sellToken_, buyToken_, weeklyLimit, expiresAt, nonce));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(USER_KEY, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function _signRevoke(uint256 nonce) private returns (bytes memory) {
        bytes32 domainTypeHash =
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        bytes32 revokeTypeHash = keccak256("Revoke(uint256 nonce)");
        bytes32 domain =
            keccak256(abi.encode(domainTypeHash, keccak256("M1 Relayer Policy"), keccak256("1"), block.chainid, user));
        bytes32 structHash = keccak256(abi.encode(revokeTypeHash, nonce));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(USER_KEY, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }
}

