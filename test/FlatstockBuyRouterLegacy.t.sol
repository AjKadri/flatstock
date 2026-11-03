pragma solidity ^0.8.24;

import {FlatstockBuyRouterLegacy, IUniswapV3SwapRouter} from "../src/FlatstockBuyRouterLegacy.sol";
import {FlatstockLock} from "../src/FlatstockLock.sol";

interface VmBuy {
    function addr(uint256 privateKey) external returns (address);
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
}

contract MockBuyWif {
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

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function burn(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
    }
}

contract MockBuyToken is MockBuyWif {}

contract MockSwapRouter {
    function exactInputSingle(IUniswapV3SwapRouter.ExactInputSingleParams calldata params)
        external
        returns (uint256 amountOut)
    {
        MockBuyToken(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        amountOut = params.amountIn * 2;
        MockBuyToken(params.tokenOut).mint(params.recipient, amountOut);
    }
}

contract FlatstockBuyRouterLegacyTest {
    VmBuy private constant vm = VmBuy(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant USER_KEY = 0xA11CE;
    address private user = vm.addr(USER_KEY);
    MockBuyWif private wif = new MockBuyWif();
    MockBuyToken private usd = new MockBuyToken();
    MockBuyToken private stock = new MockBuyToken();
    MockSwapRouter private swapRouter = new MockSwapRouter();
    FlatstockLock private lock = new FlatstockLock(address(wif), 10 ether);
    FlatstockBuyRouterLegacy private router =
        new FlatstockBuyRouterLegacy(address(wif), address(lock), address(swapRouter), 1 ether);

    function setUp() public {
        wif.mint(user, 100 ether);
        usd.mint(user, 10 ether);
        vm.prank(user);
        wif.approve(address(router), type(uint256).max);
        vm.prank(user);
        wif.approve(address(lock), type(uint256).max);
        vm.prank(user);
        usd.approve(address(router), type(uint256).max);
    }

    function testUnlockedBuyBurnsWifAndDeliversStock() public {
        uint256 supplyBefore = wif.totalSupply();
        vm.prank(user);
        uint256 amountOut = router.buyUniswap(address(usd), address(stock), 500, 1 ether, 2 ether, 0, 1 ether);

        require(amountOut == 2 ether, "swap output mismatch");
        require(stock.balanceOf(user) == 2 ether, "stock not delivered");
        require(wif.balanceOf(user) == 99 ether, "gas WIF not charged");
        require(wif.totalSupply() == supplyBefore - 1 ether, "gas WIF not burned");
    }

    function testLockedBuyIsGaslessAndLimitIsEnforced() public {
        vm.prank(user);
        lock.lock(10 ether);

        vm.prank(user);
        router.buyUniswap(address(usd), address(stock), 500, 1 ether, 2 ether, 0, 0);

        require(stock.balanceOf(user) == 2 ether, "stock not delivered");
        require(wif.balanceOf(user) == 90 ether, "locked WIF mismatch");

        vm.expectRevert(FlatstockBuyRouterLegacy.InvalidGasPayment.selector);
        vm.prank(user);
        router.buyUniswap(address(usd), address(stock), 500, 1 ether, 2 ether, 0, 1 ether);
    }
}
