// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "../interfaces/openzeppelin/IERC20.sol";

interface IAutomation {

    enum OrderType {
        LIMIT,
        STOP_LIMIT
    }

    struct ORDER {
        uint256 AllOrderId;//master id
        uint256 SubOrderId;//sub id
        OrderType orderType;
    }

    struct Pair {
        IERC20 token0;
        IERC20 token1;
    }

    event OrderCreated(uint256 orderId);
    event OrderCancelled(uint256 orderId);
}

interface ILimitOrder is IAutomation {
    event OrderProcessed(uint256 orderId, bool success, bytes result);

    struct Order {
        uint256 orderId;
        uint256 strikePrice; //defined by exchange rate of tokenIn / tokenOut
        uint256 amountIn;
        uint256 pairId;
        address recipient; //addr to receive swap results
        uint80 slippageBips;
        bool zeroForOne;
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
        uint256 pairId,
        address recipient,
        uint80 slippageBips,
        bool zeroForOne
    ) external;
}

interface IStopLimit is IAutomation {
    event OrderProcessed(uint256 orderId);

    struct Order {
        uint256 orderId;
        uint256 stopPrice;
        uint256 strikePrice;
        uint256 amountIn;
        uint256 pairId;
        address recipient; //addr to receive swap results
        uint80 slippageBips;
        bool zeroForOne;
        bool direction; //true if initial exchange rate > strike price
    }
    function createOrder(
        uint256 stopPrice,
        uint256 strikePrice,
        uint256 amountIn,
        uint256 pairId,
        address recipient,
        uint80 slippageBips,
        bool zeroForOne
    ) external;
}
