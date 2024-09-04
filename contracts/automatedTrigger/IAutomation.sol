// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/chainlink/AutomationCompatibleInterface.sol";


interface IAutomation is AutomationCompatibleInterface{

    enum OrderType {
        LIMIT,
        STOP_LIMIT
    }

    struct MasterUpkeepData {
        OrderType orderType;
        address target;//limit order swap target 
        bytes txData;//limit order swap data
        uint256 pendingOrderIdx;
        IERC20 tokenIn;
        IERC20 tokenOut;
        uint256 amountIn;
        uint256 exchangeRate;//todo consider changing size for this as length is always 8 decimals
    }

   

    event OrderCreated(uint256 orderId);
    event OrderCancelled(uint256 orderId);
}

interface ILimitOrder is IAutomation{
    event OrderProcessed(uint256 orderId, bool success, bytes result);

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

    struct UpkeepData {
        uint256 pendingOrderIdx;
        Order order;
        uint256 exchangeRate;
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

interface IStopLimit is IAutomation{
    event OrderProcessed(uint256 orderId);

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
