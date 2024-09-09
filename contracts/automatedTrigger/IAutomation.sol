// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/chainlink/AutomationCompatibleInterface.sol";

interface IAutomation is AutomationCompatibleInterface {
    enum OrderType {
        LIMIT,
        STOP_LIMIT,
        STOP_LOSS_LIMIT
    }

    struct MasterUpkeepData {
        OrderType orderType;
        address target; //limit order swap target
        bytes txData; //limit order swap data
        uint256 pendingOrderIdx;
        uint256 orderId;
        IERC20 tokenIn;
        IERC20 tokenOut;
        uint88 bips;
        uint256 amountIn;
        uint256 exchangeRate; //todo consider changing size for this as length is always 8 decimals
    }

    event OrderProcessed(uint256 orderId, bool success, bytes result);//todo include finalAmountOut?
    event OrderCreated(uint256 orderId);
    event OrderCancelled(uint256 orderId);
}

interface ILimitOrder is IAutomation {
    struct Order {
        uint256 orderId;
        uint256 strikePrice; //defined by exchange rate of tokenIn / tokenOut
        uint256 amountIn;
        IERC20 tokenIn;
        IERC20 tokenOut;
        address recipient; //addr to receive swap results
        uint88 slippageBips;
        bool direction; //true if initial exchange rate > strike price
    }

    function createOrder(
        uint256 strikePrice,
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address recipient,
        uint88 slippageBips
    ) external;
}

interface IStopLimit is IAutomation {
    event StopLimitOrderProcessed(uint256 orderId);

    struct Order {
        uint256 orderId;
        uint256 stopPrice;
        uint256 strikePrice; //defined by exchange rate of tokenIn / tokenOut
        uint256 amountIn;
        IERC20 tokenIn;
        IERC20 tokenOut;
        address recipient; //addr to receive swap results
        uint88 slippageBips;
        bool direction;
    }
    function createOrder(
        uint256 stopPrice,
        uint256 strikePrice,
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address recipient,
        uint80 slippageBips
    ) external;
}

interface IStopLossLimit is IAutomation {
    struct Order {
        uint256 orderId;
        uint256 strikePrice; //defined by exchange rate of tokenIn / tokenOut
        uint256 stopPrice;
        uint256 amountIn;
        IERC20 tokenIn;
        IERC20 tokenOut;
        address recipient; //addr to receive swap results
        uint32 slippageBipsStrike; //slippage if order is filled
        uint32 slippageBipsStop; //slippage of stop price is reached
        bool direction; //true if initial exchange rate > strike price
    }

    function createOrder(
        uint256 strikePrice,
        uint256 stopPrice,
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address recipient,
        uint32 slippageBipsStrike,
        uint32 slippageBipsStop
    ) external;

    /**
        weth => usdc

        I have USDC, I swap to WETH on order create
        when order is filled by strike or stop, I swap back to USDC and close

        So USDC is tokenOut and swapTokenIn
        and WETH is tokenIn

        If I had some other token I wanted to swap for eth, and then sell for USDC, this token would be swapTokenIn instead of USDC

     */
    ///@param swapTokenIn may or may not be the same as @param tokenOut
    struct SwapParams {
        IERC20 swapTokenIn;
        uint256 swapAmountIn;
        address swapTarget;
        uint32 swapBips;
        bytes txData;
    }
    ///@notice this will perform a swap when order is created
    ///Initial swap tokenOut will always be @param tokenIn, which will be the resulting order tokenIn
    function createOrderWithSwap(
        SwapParams calldata swapParams,
        uint256 strikePrice,
        uint256 stopPrice,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address recipient,
        uint32 slippageBipsStrike,
        uint32 slippageBipsStop
    ) external;
}
