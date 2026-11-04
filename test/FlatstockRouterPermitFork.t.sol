pragma solidity ^0.8.24;

import {FlatstockRouter} from "../src/FlatstockRouter.sol";

interface VmRouterPermitFork {
    function addr(uint256 privateKey) external returns (address);
    function envOr(string calldata key, uint256 defaultValue) external returns (uint256 value);
    function expectRevert(bytes4 selector) external;
    function getChainId() external returns (uint256);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 newTimestamp) external;
}

interface ForkPermitToken {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function name() external view returns (string memory);
    function nonces(address owner) external view returns (uint256);
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

interface ForkRouter {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function SELL_TYPEHASH() external view returns (bytes32);
    function sellBySig(
        address user,
        address sellToken,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 amountOut);
    function sellNonces(address user) external view returns (uint256);
}

interface ForkLock {
    function isLocked(address account) external view returns (bool);
}

contract FlatstockRouterPermitForkTest {
    VmRouterPermitFork private constant vm =
        VmRouterPermitFork(address(uint160(uint256(keccak256("hevm cheat code")))));
    ForkPermitToken private constant nvda = ForkPermitToken(0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC);
    ForkRouter private constant router = ForkRouter(0x8799a2eF390dE8b0Ef97919C7e040C44DdFadbe7);
    ForkLock private constant lockContract = ForkLock(0x2421E6F3fbaAFB96e0987208a1f3AC51F46EE121);
    address private constant expectedUser = 0x3554121694a2472300f079Afa4B1fC7F9aAFac01;

    function _applyPermit(uint256 userKey, uint256 amountIn, uint256 deadline) private {
        bytes32 permitTypeHash =
            keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");
        bytes32 permitStructHash = keccak256(
            abi.encode(permitTypeHash, expectedUser, address(router), amountIn, nvda.nonces(expectedUser), deadline)
        );
        bytes32 permitDigest = keccak256(abi.encodePacked("\x19\x01", nvda.DOMAIN_SEPARATOR(), permitStructHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userKey, permitDigest);
        nvda.permit(expectedUser, address(router), amountIn, deadline, v, r, s);
    }

    function _signSell(uint256 userKey, uint256 amountIn, uint256 deadline) private returns (bytes memory) {
        bytes32 sellStructHash = keccak256(
            abi.encode(
                router.SELL_TYPEHASH(),
                expectedUser,
                address(nvda),
                uint24(500),
                amountIn,
                type(uint256).max,
                uint256(0),
                deadline
            )
        );
        bytes32 sellDigest = keccak256(abi.encodePacked("\x19\x01", router.DOMAIN_SEPARATOR(), sellStructHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userKey, sellDigest);
        return abi.encodePacked(r, s, v);
    }

    function testRealNvdaPermitAndFailedSellStayBoundedOnFork() public {
        if (vm.getChainId() != 4663) return;
        uint256 userKey = vm.envOr("M1_USER_PRIVATE_KEY", uint256(0));
        if (userKey == 0 || vm.addr(userKey) != expectedUser) return;
        if (!lockContract.isLocked(expectedUser)) return;

        uint256 amountIn = 1_000_000_000_000_000;
        if (nvda.balanceOf(expectedUser) < amountIn) return;
        uint256 deadline = block.timestamp + 5 minutes;
        _applyPermit(userKey, amountIn, deadline);

        uint256 balanceBefore = nvda.balanceOf(expectedUser);
        require(nvda.allowance(expectedUser, address(router)) == amountIn, "fork permit was not exact");
        bytes memory sellSignature = _signSell(userKey, amountIn, deadline);
        vm.expectRevert(FlatstockRouter.SwapFailed.selector);
        router.sellBySig(expectedUser, address(nvda), 500, amountIn, type(uint256).max, 0, 0, deadline, sellSignature);

        require(nvda.balanceOf(expectedUser) == balanceBefore, "failed fork sell moved NVDA");
        require(nvda.allowance(expectedUser, address(router)) == amountIn, "failed fork sell widened allowance");
        require(router.sellNonces(expectedUser) == 0, "failed fork sell consumed nonce");

        vm.warp(deadline + 1);
        vm.expectRevert(FlatstockRouter.SignatureExpired.selector);
        router.sellBySig(expectedUser, address(nvda), 500, amountIn, type(uint256).max, 0, 0, deadline, sellSignature);
    }
}
