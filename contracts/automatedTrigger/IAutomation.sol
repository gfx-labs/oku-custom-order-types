// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/chainlink/AutomationCompatibleInterface.sol";
/**
BIG PICTURE TODO
depricate regular limit order in favor of stop-loss-limit? This means updating stop-limit to create a stop-loss-limit order on fill
-do we want to allow stop-limit to be able to swap on create when it fills? 
Make sure that swap data on performUpkeep can only actually perform upkeep on the intended order without using user funds its not supposed to
 */
interface IAutomation is AutomationCompatibleInterface {
    enum OrderType {
        STOP_LIMIT,
        STOP_LOSS_LIMIT
    }

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

    event OrderProcessed(uint256 orderId, bool success, bytes result); //todo include finalAmountOut?
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
        uint256 stopLimitPrice;
        uint256 stopPrice;
        uint256 strikePrice; 
        uint256 amountIn;
        IERC20 tokenIn;
        IERC20 tokenOut;
        address recipient;
        uint32 strikeSlippage;
        uint32 stopSlippage;
        uint32 swapSlippage;
        bool direction;
        bool swapOnFill;
    }

    ///@notice if no stop loss is desired, set to 0
    ///@param tokenIn asset to provide
    ///@param tokenOut asset to receive after resulting limit order is filled
    ///@param stopLimitPrice execution price for stop limit order
    ///@param strikePrice execution 'take profit' price for resulting limit order 
    ///@param stopPrice execution 'stop loss' price for resulting limit order
    ///@param swapSlippage slippage for optional swap, only used if @param swapOnFill is true
    function createOrder(
        uint256 stopLimitPrice,
        uint256 strikePrice,
        uint256 stopPrice,
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address recipient,
        uint32 strikeSlipapge,
        uint32 stopSlippage,
        uint32 swapSlippage,
        bool swapOnFill
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
