pragma solidity ^0.8.24;

import {FlatIndexEIP712} from "./FlatIndexEIP712.sol";
import {FlatIndexLock} from "./FlatIndexLock.sol";

interface IMetaToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IMetaPermitToken is IMetaToken {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

interface IMetaWif is IMetaToken {}

interface IMetaSwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut);
}

/// @notice Non-custodial swap router with direct wallet calls and exact,
/// signature-authorized relayed calls for locked WIF wallets.
contract FlatIndexMetaRouter is FlatIndexEIP712 {
    bytes32 public constant BUY_TYPEHASH = keccak256(
        "BuyMix(address user,bytes32 legsHash,uint256 amountIn,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant SELL_TYPEHASH = keccak256(
        "SellStock(address user,address token,uint24 fee,uint256 amountIn,uint256 amountOutMinimum,uint256 nonce,uint256 deadline)"
    );

    struct Leg {
        address token;
        uint24 fee;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct PermitData {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    IMetaToken public immutable usdg;
    FlatIndexLock public immutable lockContract;
    address public immutable swapRouter;

    mapping(address => uint256) public buyNonces;
    mapping(address => uint256) public sellNonces;

    error InvalidAddress();
    error InvalidAmount();
    error InvalidMinimumOutput();
    error InvalidPermit();
    error InvalidNonce();
    error SignatureExpired();
    error NotLocked();
    error TransferFailed();
    error ApprovalFailed();
    error SwapFailed();
    error PlanMismatch();

    event TradeExecuted(
        address indexed account,
        address indexed sellToken,
        address indexed buyToken,
        uint256 amountIn,
        uint256 amountOut,
        uint8 kind
    );

    constructor(address usdg_, address lockContract_, address swapRouter_)
        FlatIndexEIP712("Flatstock Trades", "1")
    {
        if (usdg_ == address(0) || lockContract_ == address(0) || swapRouter_ == address(0)) revert InvalidAddress();
        usdg = IMetaToken(usdg_);
        lockContract = FlatIndexLock(lockContract_);
        swapRouter = swapRouter_;
    }

    function buyUniswap(
        address sellToken,
        address buyToken,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96
    ) external returns (uint256 amountOut) {
        amountOut = _swap(msg.sender, sellToken, buyToken, fee, amountIn, amountOutMinimum, sqrtPriceLimitX96, 0);
    }

    function sellUniswap(
        address sellToken,
        address buyToken,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96
    ) external returns (uint256 amountOut) {
        amountOut = _swap(msg.sender, sellToken, buyToken, fee, amountIn, amountOutMinimum, sqrtPriceLimitX96, 1);
    }

    function buyMix(Leg[] calldata legs, uint256 amountIn) external returns (uint256[] memory amountsOut) {
        if (amountIn == 0 || legs.length == 0) revert InvalidAmount();
        uint256 total;
        for (uint256 i; i < legs.length; ++i) total += legs[i].amountIn;
        if (total != amountIn) revert PlanMismatch();
        if (!usdg.transferFrom(msg.sender, address(this), amountIn)) revert TransferFailed();
        amountsOut = new uint256[](legs.length);
        for (uint256 i; i < legs.length; ++i) {
            amountsOut[i] = _swapHeld(msg.sender, address(usdg), legs[i], 0);
        }
    }

    function buyMixBySig(
        address user,
        Leg[] calldata legs,
        uint256 amountIn,
        uint256 nonce,
        uint256 deadline,
        PermitData calldata permitData,
        bytes calldata signature
    ) external returns (uint256[] memory amountsOut) {
        if (!lockContract.isLocked(user)) revert NotLocked();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (nonce != buyNonces[user]) revert InvalidNonce();
        if (amountIn == 0 || legs.length == 0) revert InvalidAmount();
        if (keccak256(abi.encode(legs)) == bytes32(0)) revert PlanMismatch();
        if (_recover(_hashTypedData(keccak256(abi.encode(
            BUY_TYPEHASH, user, keccak256(abi.encode(legs)), amountIn, nonce, deadline
        ))), signature) != user) revert InvalidSignature();

        uint256 total;
        for (uint256 i; i < legs.length; ++i) total += legs[i].amountIn;
        if (total != amountIn) revert PlanMismatch();
        buyNonces[user] = nonce + 1;
        _permitIfPresent(user, permitData, amountIn);
        if (!usdg.transferFrom(user, address(this), amountIn)) revert TransferFailed();

        amountsOut = new uint256[](legs.length);
        for (uint256 i; i < legs.length; ++i) {
            amountsOut[i] = _swapHeld(user, address(usdg), legs[i], 0);
        }
    }

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
    ) external returns (uint256 amountOut) {
        if (!lockContract.isLocked(user)) revert NotLocked();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (nonce != sellNonces[user]) revert InvalidNonce();
        if (sellToken == address(0) || amountIn == 0 || amountOutMinimum == 0) revert InvalidAmount();
        bytes32 structHash = keccak256(abi.encode(
            SELL_TYPEHASH, user, sellToken, fee, amountIn, amountOutMinimum, nonce, deadline
        ));
        if (_recover(_hashTypedData(structHash), signature) != user) revert InvalidSignature();
        sellNonces[user] = nonce + 1;
        if (!IMetaToken(sellToken).transferFrom(user, address(this), amountIn)) revert TransferFailed();
        Leg memory leg = Leg(address(usdg), fee, amountIn, amountOutMinimum, sqrtPriceLimitX96);
        amountOut = _swapHeld(user, sellToken, leg, 1);
    }

    function _permitIfPresent(address user, PermitData calldata permitData, uint256 amountIn) internal {
        if (permitData.deadline == 0) return;
        if (permitData.value < amountIn || permitData.deadline < block.timestamp) revert InvalidPermit();
        IMetaPermitToken(address(usdg)).permit(
            user,
            address(this),
            permitData.value,
            permitData.deadline,
            permitData.v,
            permitData.r,
            permitData.s
        );
    }

    function _swapHeld(address account, address sellToken, Leg memory leg, uint8 kind)
        internal
        returns (uint256 amountOut)
    {
        if (leg.amountIn == 0 || leg.amountOutMinimum == 0 || leg.token == address(0)) revert InvalidMinimumOutput();
        if (!IMetaToken(sellToken).approve(swapRouter, leg.amountIn)) revert ApprovalFailed();
        try IMetaSwapRouter(swapRouter).exactInputSingle(IMetaSwapRouter.ExactInputSingleParams({
            tokenIn: sellToken,
            tokenOut: leg.token,
            fee: leg.fee,
            recipient: account,
            amountIn: leg.amountIn,
            amountOutMinimum: leg.amountOutMinimum,
            sqrtPriceLimitX96: leg.sqrtPriceLimitX96
        })) returns (uint256 result) {
            amountOut = result;
        } catch {
            revert SwapFailed();
        }
        emit TradeExecuted(account, sellToken, leg.token, leg.amountIn, amountOut, kind);
    }

    function _swap(
        address account,
        address sellToken,
        address buyToken,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96,
        uint8 kind
    ) internal returns (uint256 amountOut) {
        if (sellToken == address(0) || buyToken == address(0) || amountIn == 0) revert InvalidAmount();
        if (!IMetaToken(sellToken).transferFrom(account, address(this), amountIn)) revert TransferFailed();
        Leg memory leg = Leg(buyToken, fee, amountIn, amountOutMinimum, sqrtPriceLimitX96);
        amountOut = _swapHeld(account, sellToken, leg, kind);
    }
}
