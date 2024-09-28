// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/chainlink/AutomationCompatibleInterface.sol";

interface IAutomation is AutomationCompatibleInterface {
    enum OrderType {
        STOP_LIMIT,
        STOP_LOSS_LIMIT
    }

    ///@notice params for swap on limit order create
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
        address target;
        IERC20 tokenIn;
        IERC20 tokenOut;
        uint96 orderId;
        uint16 pendingOrderIdx;
        uint88 bips;
        uint256 amountIn;
        uint256 exchangeRate;
        bytes txData;
    }

    event OrderProcessed(uint256 orderId, bool success, bytes result);
    event OrderCreated(uint256 orderId);
    event OrderCancelled(uint256 orderId);
}

interface IStopLimit is IAutomation {
    event StopLimitOrderProcessed(uint256 orderId);

    struct Order {
        uint256 stopLimitPrice;
        uint256 stopPrice;
        uint256 strikePrice;
        uint256 amountIn;
        uint96 orderId;
        IERC20 tokenIn;
        IERC20 tokenOut;
        address recipient;
        uint16 strikeSlippage;
        uint16 stopSlippage;
        uint16 swapSlippage;
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
        uint16 strikeSlipapge,
        uint16 stopSlippage,
        uint16 swapSlippage,
        bool swapOnFill
    ) external;
}

interface IStopLossLimit is IAutomation {
    struct Order {
        uint256 strikePrice; //defined by exchange rate of tokenIn / tokenOut
        uint256 stopPrice;
        uint256 amountIn;
        uint96 orderId;
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
