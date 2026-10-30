pragma solidity ^0.8.24;

import {FlatIndexLock} from "./FlatIndexLock.sol";

interface IBuyToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IBuyWif is IBuyToken {
    function burn(uint256 amount) external;
}

interface IUniswapV3SwapRouter {
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

/// @notice Non-custodial buy entry point for the M2 relayer demonstration.
/// @dev Tokens are pulled from the caller only for the duration of a swap and
/// the output recipient is always the caller. Unlocked callers pay a fixed WIF
/// amount that is burned; locked callers pay no WIF amount.
contract FlatIndexBuyRouter {
    IBuyWif public immutable wif;
    FlatIndexLock public immutable lockContract;
    address public immutable swapRouter;
    uint256 public immutable gasWif;

    error InvalidAddress();
    error InvalidGasPayment();
    error TransferFailed();
    error ApprovalFailed();
    error SwapFailed();

    event GasPaidInWif(address indexed account, uint256 amount);
    event MixBought(
        address indexed account,
        address indexed sellToken,
        address indexed buyToken,
        uint256 amountIn,
        uint256 amountOut,
        bool lockedAccount
    );

    constructor(address wif_, address lockContract_, address swapRouter_, uint256 gasWif_) {
        if (wif_ == address(0) || lockContract_ == address(0) || swapRouter_ == address(0) || gasWif_ == 0) {
            revert InvalidAddress();
        }
        wif = IBuyWif(wif_);
        lockContract = FlatIndexLock(lockContract_);
        swapRouter = swapRouter_;
        gasWif = gasWif_;
    }

    function buyUniswap(
        address sellToken,
        address buyToken,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96,
        uint256 gasWifAmount
    ) external returns (uint256 amountOut) {
        bool lockedAccount = lockContract.isLocked(msg.sender);
        if (lockedAccount) {
            if (gasWifAmount != 0) revert InvalidGasPayment();
        } else {
            if (gasWifAmount != gasWif) revert InvalidGasPayment();
            if (!wif.transferFrom(msg.sender, address(this), gasWifAmount)) revert TransferFailed();
            wif.burn(gasWifAmount);
            emit GasPaidInWif(msg.sender, gasWifAmount);
        }

        if (amountIn == 0 || sellToken == address(0) || buyToken == address(0)) revert InvalidAddress();
        if (!IBuyToken(sellToken).transferFrom(msg.sender, address(this), amountIn)) revert TransferFailed();
        if (!IBuyToken(sellToken).approve(swapRouter, amountIn)) revert ApprovalFailed();

        IUniswapV3SwapRouter.ExactInputSingleParams memory params = IUniswapV3SwapRouter.ExactInputSingleParams({
            tokenIn: sellToken,
            tokenOut: buyToken,
            fee: fee,
            recipient: msg.sender,
            amountIn: amountIn,
            amountOutMinimum: amountOutMinimum,
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });
        try IUniswapV3SwapRouter(swapRouter).exactInputSingle(params) returns (uint256 result) {
            amountOut = result;
        } catch {
            revert SwapFailed();
        }
        emit MixBought(msg.sender, sellToken, buyToken, amountIn, amountOut, lockedAccount);
    }
}
