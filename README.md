# Automated Order System Contracts

This repository contains the smart contracts for an automated trading system, designed to execute orders as they come within range. There are two primary types of orders supported by the system: **Bracket Orders** and **Stop Limit Orders**.

## Order Types

### 1. Bracket Orders
A **Bracket Order** executes an automated swap when either the `takeProfit` or `stopPrice` conditions are met. The purpose of a Bracket Order is to allow traders to define both a profit target (`takeProfit`) and a stop loss (`stopPrice`) in a single transaction. The order is filled when either of these price conditions is reached, swapping the input token (`tokenIn`) for the output token (`tokenOut`).

- **`takeProfit`**: The execution price at which a profit target is reached.
- **`stopPrice`**: The price at which the order is closed to limit losses.

### 2. Stop Limit Orders
A **Stop Limit Order** is used to trigger the creation of a new Bracket Order when the `stopLimitPrice` condition is met. Once the stop limit price is reached, a Bracket Order is automatically created using the same unique `orderId` and parameters such as `takeProfit` and `stopPrice`. 

- **Shared Order ID**: Both the Stop Limit Order and the resulting Bracket Order share the same `orderId` for easy tracking and management.

### Additional Order Types
- **Limit Order**: By setting the `stopPrice` to 0, the system will create a standard **limit order**. This order type will only execute when the `takeProfit` is reached.
  
- **Stop Loss Order**: By setting the `takeProfit` to the maximum possible value (`2 ** 256 - 1`), the system will create a **stop loss order**. This order type executes when the `stopPrice` is reached to minimize potential losses.

## Contract Interfaces

### IAutomation
The main contract for handling automation logic, which fills orders when conditions are met. This contract defines the core structures and event flow for automated order processing. Key elements include:
- **Order Types** (`OrderType`): Identifies whether an order is a `STOP_LIMIT` or `BRACKET` order.
- **Permit2** integration (`Permit2Payload`): Encodes permit2 data for token approvals.
- **Swap Params** (`SwapParams`): Holds details for swaps triggered during order execution, such as slippage, swap amount, and transaction data.

### IStopLimit
Handles Stop Limit orders, which create Bracket orders once filled. The `Order` struct for Stop Limit Orders includes additional parameters such as `stopLimitPrice`, `swapSlippage`, and `swapOnFill`.

### IBracket
Manages Bracket orders that execute trades when either the `takeProfit` or `stopPrice` is reached. These orders swap the input token (`tokenIn`) for the output token (`tokenOut`) and define both profit-taking and stop-loss parameters.

## Events
The system triggers key events during the order lifecycle:
- **OrderProcessed**: Emitted when an order is successfully filled or if an error occurs.
- **OrderCreated**: Emitted when a new order is placed.
- **OrderCancelled**: Emitted when an order is canceled.

## Usage

1. **Creating a Bracket Order**: A Bracket Order is created by specifying the target `takeProfit` and `stopPrice` along with the amount of the input token to sell. Once either condition is met, the trade is executed.
  
2. **Creating a Stop Limit Order**: A Stop Limit Order is created by specifying the `stopLimitPrice`, `takeProfit`, and `stopPrice`. When the `stopLimitPrice` is reached, a new Bracket Order is created with the same `orderId` as the Stop Limit Order.

## Example Transactions

- **Bracket Order Creation**:
    ```solidity
    function createOrder(
        bytes calldata swapPayload,     // Optional data for executing a swap when the Stop Limit order is filled
        uint256 takeProfit,             // Price to trigger take-profit.
        uint256 stopPrice,              // Price to trigger stop-loss.
        uint256 amountIn,               // Amount of tokenIn to sell when conditions are met.
        IERC20 tokenIn,                 // Token to sell
        IERC20 tokenOut,                // Token to buy.
        address recipient,              // Address to receive tokenOut once the order is filled.
        uint16 takeProfitSlippage,      // Slippage tolerance for take-profit price, defined simply in basis points.
        uint16 stopSlippage,            // Slippage tolerance for stop-loss price, defined simply in basis points.
        bool permit,                    // Indicates whether Permit2 is used for token approvals.
        bytes calldata permitPayload    // Permit2 signature payload for approval-less token transfers.
    ) external;
    ```

- **Stop Limit Order Creation**:
    ```solidity
    function createOrder(
        uint256 stopLimitPrice,         // Price to trigger the Stop Limit order.
        uint256 takeProfit,             // Target price for the resulting Bracket Order to take profit.
        uint256 stopPrice,              // Stop-loss price for the resulting Bracket Order.
        uint256 amountIn,               // Amount of tokenIn to sell when conditions are met.
        IERC20 tokenIn,                 // Token to sell.
        IERC20 tokenOut,                // Token to buy.
        address recipient,              // Address to receive tokenOut once the order is filled.
        uint16 takeProfitSlippage,      // Slippage tolerance for the take-profit price in the Bracket Order.
        uint16 stopSlippage,            // Slippage tolerance for the stop-loss price in the Bracket Order.
        uint16 swapSlippage,            // Slippage tolerance for the initial swap when the Stop Limit order is filled.
        bool swapOnFill,                // Determines if the tokens should be swapped immediately after the Stop Limit order is filled.
        bool permit,                    // Indicates whether Permit2 is used for token approvals.
        bytes calldata permitPayload    // Permit2 signature payload for approval-less token transfers.
    ) external;
    ```

## Oracles

Oracles are expected to return a USD price in 1e8 terms, so the price of USDC should be returned as ~1e8 or ~```100000000```

## Testing

In order to run the tests, create a .env file and add a MAINNET_URL and ARB_URL and assign these to the appropriate RPC addresses. Here is an example .env file: 

```
MAINNET_URL="https://rpc.ankr.com/eth"
ARB_URL="https://rpc.ankr.com/arbitrum"
```
Then the tests can be run by ```npm run test```
