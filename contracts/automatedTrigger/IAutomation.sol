// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/chainlink/AutomationCompatibleInterface.sol";
import "../interfaces/uniswapV3/IPermit2.sol";

interface IAutomation is AutomationCompatibleInterface {
    ///@notice force a revert if the external call fails
    error TransactionFailed(bytes reason);

    ///@notice allow the AutomationMaster to determine what kind of order is being filled
    enum OrderType {
        STOP_LIMIT,
        BRACKET
    }

    ///@notice encode permit2 data into a single struct
    struct Permit2Payload {
        IPermit2.PermitSingle permitSingle;
        bytes signature;
    }

    ///@notice params for swap on limit order create
    ///@param swapTokenIn may or may not be the same as @param tokenOut
    ///@param swapAmountIn amount to swap
    ///@param swapSlippage raw bips of slippage allowed
    ///@param txData transaction data to be sent to the target to make the swap
    struct SwapParams {
        IERC20 swapTokenIn;
        uint256 swapAmountIn;
        address swapTarget;
        uint16 swapSlippage;
        bytes txData;
    }

    ///@notice standard return expected from checkUpkeep upkeep is needed
    ///@param orderType enum allow the AutomationMaster to determine what kind of order is being filled
    ///@param target address to send the transaction data to in order to perform the swap
    ///@param tokenIn token sold in the swap
    ///@param tokenOut token bought in the swap
    ///@param orderId unique id to associate the order
    ///@param pendingOrderIdx index of the pending order in the array
    ///@param slippage raw bips for the upcoming swap
    ///@param amountIn amount of @param tokenIn to sell
    ///@param exchangeRate current exchange rate of @param tokenIn => @param tokenOut
    ///@param txData transaction data to be sent to @param target to make the swap
    struct MasterUpkeepData {
        OrderType orderType;
        address target;
        IERC20 tokenIn;
        IERC20 tokenOut;
        uint96 orderId;
        uint96 pendingOrderIdx;
        uint16 slippage;
        uint256 amountIn;
        uint256 exchangeRate;
        bytes txData;
    }

    event OrderProcessed(uint256 orderId, bool success, bytes result);
    event OrderCreated(uint256 orderId);
    event OrderCancelled(uint256 orderId);
}

///@notice Stop Limit orders create a new bracket order once filled
/// the resulting bracket order will have the same unique order ID but will exist on the Bracket contract
interface IStopLimit is IAutomation {
    ///@notice emitted when an order is filled
    event StopLimitOrderProcessed(uint256 orderId);

    ///@notice StopLimit orders create a new bracket order once @param stopLimitPrice is reached
    ///@param stopLimitPrice execution price to fill the Stop Limit order
    ///@param takeProfit execution price for resulting Bracket order
    ///@param stopPrice execution price for resulting Bracket order
    ///@param amountIn amount of @param tokenIn to sell
    ///@param orderId unique id to associate the order
    ///@param tokenIn token sold in the swap
    ///@param tokenOut token bought in the swap
    ///@param recipient owner of the order and receiver of the funds once the order is closed
    ///@param takeProfitSlippage raw bips used to determine slippage for resulting Bracket order once @param takeProfit is reached
    ///@param stopSlippage raw bips used to determine slippage for resulting Bracket order once @param stopPrice is reached
    ///@param swapSlippage raw bips used to determine slippage for resulting swap if @param swapOnFill is true
    ///@param direction determines the expected direction of price movement
    ///@param swapOnFill determines if @param tokenIn is swapped for @param tokenOut once the Stop Limit order is filled
    struct Order {
        uint256 stopLimitPrice;
        uint256 takeProfit;
        uint256 stopPrice;
        uint256 amountIn;
        uint96 orderId;
        IERC20 tokenIn;
        IERC20 tokenOut;
        address recipient;
        uint16 takeProfitSlippage;
        uint16 stopSlippage;
        uint16 swapSlippage;
        bool direction;
        bool swapOnFill;
    }

    ///@notice StopLimit orders create a new bracket order once filled
    ///@param stopLimitPrice execution price to fill the Stop Limit order
    ///@param takeProfit execution price for resulting Bracket order
    ///@param stopPrice execution price for resulting Bracket order
    ///@param amountIn amount of @param tokenIn to sell
    ///@param tokenIn token sold in the swap
    ///@param tokenOut token bought in the swap
    ///@param recipient owner of the order and receiver of the funds once the order is closed
    ///@param takeProfitSlippage raw bips used to determine slippage for resulting Bracket order once @param takeProfit is reached
    ///@param stopSlippage raw bips used to determine slippage for resulting Bracket order once @param stopPrice is reached
    ///@param swapSlippage raw bips used to determine slippage for resulting swap if @param swapOnFill is true
    ///@param swapOnFill determines if @param tokenIn is swapped for @param tokenOut once the Stop Limit order is filled
    ///@param permit is true if using permit2, false if using legacy ERC20 approve
    ///@param permitPayload encoded permit data matching the Permit2Payload struct
    ///@notice @param permitPayload may be empty or set to "0x" if @param permit is false
    function createOrder(
        uint256 stopLimitPrice,
        uint256 takeProfit,
        uint256 stopPrice,
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address recipient,
        uint16 takeProfitSlippage,
        uint16 stopSlippage,
        uint16 swapSlippage,
        bool swapOnFill,
        bool permit,
        bytes calldata permitPayload
    ) external;

    ///@param orderId unique id to reference the order being modified
    ///@param stopLimitPrice new execution price to fill the Stop Limit order
    ///@param takeProfit new execution price for resulting Bracket order
    ///@param stopPrice new execution price for resulting Bracket order
    ///@param amountInDelta amount to either increase or decrease the position, depending on @param increasePosition
    ///@param tokenOut new token to be bought in the swap
    ///@param recipient new owner of the order and receiver of the funds once the order is closed
    ///@param takeProfitSlippage new raw bips used to determine slippage for resulting Bracket order once @param takeProfit is reached
    ///@param stopSlippage new raw bips used to determine slippage for resulting Bracket order once @param stopPrice is reached
    ///@param swapSlippage new raw bips used to determine slippage for resulting swap if @param swapOnFill is true
    ///@param swapOnFill determines if @param tokenIn is swapped for @param tokenOut once the Stop Limit order is filled
    ///@param permit is true if using permit2, false if using legacy ERC20 approve
    ///@param increasePosition true if adding to the position, false if reducing the position
    ///@notice @param permit & @param permitPayload are not referenced if @param increasePosition is false
    ///@param permitPayload encoded permit data matching the Permit2Payload struct
    ///@notice @param permitPayload may be empty or set to "0x" if @param permit is false
    function modifyOrder(
        uint96 orderId,
        uint256 stopLimitPrice,
        uint256 takeProfit,
        uint256 stopPrice,
        uint256 amountInDelta,
        IERC20 tokenOut,
        address recipient,
        uint16 takeProfitSlippage,
        uint16 stopSlippage,
        uint16 swapSlippage,
        bool swapOnFill,
        bool permit,
        bool increasePosition,
        bytes calldata permitPayload
    ) external;
}

interface IBracket is IAutomation {
    ///@notice Bracket orders are filled when either @param takeProfit or @param stopPrice are reached,
    /// at which time @param tokenIn is swapped for @param tokenOut
    ///@param takeProfit execution price for resulting Bracket order
    ///@param stopPrice execution price for resulting Bracket order
    ///@param amountIn amount of @param tokenIn to sell
    ///@param orderId unique id to associate the order
    ///@param tokenIn token sold in the swap
    ///@param tokenOut token bought in the swap
    ///@param recipient owner of the order and receiver of the funds once the order is closed
    ///@param takeProfitSlippage raw bips used to determine slippage for resulting Bracket order once @param takeProfit is reached
    ///@param stopSlippage raw bips used to determine slippage for resulting Bracket order once @param stopPrice is reached
    ///@param direction determines the expected direction of price movement
    struct Order {
        uint256 takeProfit; //defined by exchange rate of tokenIn / tokenOut
        uint256 stopPrice;
        uint256 amountIn;
        uint96 orderId;
        IERC20 tokenIn;
        IERC20 tokenOut;
        address recipient; //addr to receive swap results
        uint16 takeProfitSlippage; //slippage if order is filled
        uint16 stopSlippage; //slippage of stop price is reached
        bool direction; //true if initial exchange rate > strike price
    }

    

    ///@notice Bracket orders are filled when either @param takeProfit or @param stopPrice are reached,
    /// at which time @param tokenIn is swapped for @param tokenOut    ///@param stopLimitPrice execution price to fill the Stop Limit order
    ///@param takeProfit execution price for resulting Bracket order
    ///@param stopPrice execution price for resulting Bracket order
    ///@param amountIn amount of @param tokenIn to sell
    ///@param tokenIn token sold in the swap
    ///@param tokenOut token bought in the swap
    ///@param recipient owner of the order and receiver of the funds once the order is closed
    ///@param takeProfitSlippage raw bips used to determine slippage for resulting Bracket order once @param takeProfit is reached
    ///@param stopSlippage raw bips used to determine slippage for resulting Bracket order once @param stopPrice is reached
    ///@param permit is true if using permit2, false if using legacy ERC20 approve
    ///@param permitPayload encoded permit data matching the Permit2Payload struct
    ///@notice @param permitPayload may be empty or set to "0x" if @param permit is false
    function createOrder(
        bytes calldata swapPayload,
        uint256 takeProfit,
        uint256 stopPrice,
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address recipient,
        uint16 takeProfitSlippage,
        uint16 stopSlippage,
        bool permit,
        bytes calldata permitPayload
    ) external;

    ///@notice create a new Bracket order as a Stop Limit order is filled
    ///@notice @param existingOrderId allows the use of the same orderId for the resulting Bracket order
    function fillStopLimitOrder(
        bytes calldata swapPayload,
        uint256 takeProfit,
        uint256 stopPrice,
        uint256 amountIn,
        uint96 existingOrderId,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address recipient,
        uint16 takeProfitSlippage,
        uint16 stopSlippage,
        bool permit,
        bytes calldata permitPayload
    ) external;


    ///@param orderId unique id to reference the order being modified
    ///@param takeProfit new execution price for resulting Bracket order
    ///@param stopPrice new execution price for resulting Bracket order
    ///@param amountInDelta amount to either increase or decrease the position, depending on @param increasePosition
    ///@param tokenOut new token to be bought in the swap
    ///@param recipient new owner of the order and receiver of the funds once the order is closed
    ///@param takeProfitSlippage new raw bips used to determine slippage for resulting Bracket order once @param takeProfit is reached
    ///@param stopSlippage new raw bips used to determine slippage for resulting Bracket order once @param stopPrice is reached
    ///@param permit is true if using permit2, false if using legacy ERC20 approve
    ///@param increasePosition true if adding to the position, false if reducing the position
    ///@notice @param permit & @param permitPayload are not referenced if @param increasePosition is false
    ///@param permitPayload encoded permit data matching the Permit2Payload struct
    ///@notice @param permitPayload may be empty or set to "0x" if @param permit is false
    function modifyOrder(
        uint96 orderId,
        uint256 takeProfit,
        uint256 stopPrice,
        uint256 amountInDelta,
        IERC20 tokenOut,
        address recipient,
        uint16 takeProfitSlippage,
        uint16 stopSlippage,
        bool permit,
        bool increasePosition,
        bytes calldata permitPayload
    ) external;
}
