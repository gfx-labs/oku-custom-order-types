// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "./IAutomation.sol";
import "./AutomationMaster.sol";
import "../libraries/ArrayMutation.sol";

import "../interfaces/ILimitOrderRegistry.sol";
import "../interfaces/uniswapV3/UniswapV3Pool.sol";
import "../interfaces/uniswapV3/ISwapRouter02.sol";
import "../interfaces/openzeppelin/Ownable.sol";
import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/openzeppelin/SafeERC20.sol";

import "../oracle/IOracleRelay.sol";

///testing
import "hardhat/console.sol";

///@notice This contract owns and handles all logic associated with STOP_LIMIT orders
///STOP_LIMIT orders create a new limit order order once filled
contract StopLimit is Ownable, IStopLimit {
    using SafeERC20 for IERC20;

    AutomationMaster public immutable MASTER;
    IStopLossLimit public immutable SLL_CONTRACT;

    uint256 public orderCount;

    uint256[] public pendingOrderIds;

    mapping(uint256 => Order) public orders;

    constructor(AutomationMaster _master, IStopLossLimit _sll) {
        MASTER = _master;
        SLL_CONTRACT = _sll;
    }

    function getPendingOrders() external view returns (uint256[] memory) {
        return pendingOrderIds;
    }

    ///@param stopLimitPrice price at which the limit order is created
    ///@param strikePrice or @param stopPrice is the price at which the limit order is closed
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
    ) external override {
        //verify both oracles exist, as we need both to calc the exchange rate
        require(
            address(MASTER.oracles(tokenIn)) != address(0x0),
            "tokenIn Oracle !exist"
        );
        require(
            address(MASTER.oracles(tokenIn)) != address(0x0),
            "tokenOut Oracle !exist"
        );

        require(
            orderCount < MASTER.maxPendingOrders(),
            "Max Order Count Reached"
        );
        require(
            strikeSlipapge <= MASTER.MAX_BIPS() &&
                stopSlippage <= MASTER.MAX_BIPS(),
            "invalid slippage"
        );

        MASTER.checkMinOrderSize(tokenIn, amountIn);

        orderCount++;
        orders[orderCount] = Order({
            orderId: orderCount,
            stopLimitPrice: stopLimitPrice,
            stopPrice: stopPrice,
            strikePrice: strikePrice,
            amountIn: amountIn,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            strikeSlippage: strikeSlipapge,
            stopSlippage: stopSlippage,
            swapSlippage: swapSlippage,
            recipient: recipient,
            direction: MASTER.getExchangeRate(tokenIn, tokenOut) > stopPrice, //compare to stop price for this order's direction
            swapOnFill: swapOnFill
        });
        pendingOrderIds.push(orderCount);

        //take asset
        tokenIn.safeTransferFrom(recipient, address(this), amountIn);

        //emit
        emit OrderCreated(orderCount);
    }

    function adminCancelOrder(uint256 orderId) external onlyOwner {
        _cancelOrder(orderId);
    }

    ///@notice only the order recipient can cancel their order
    ///@notice only pending orders can be cancelled
    function cancelOrder(uint256 orderId) external {
        Order memory order = orders[orderId];
        require(msg.sender == order.recipient, "Only Order Owner");
        require(_cancelOrder(orderId), "Order not active");
    }

    function _cancelOrder(uint256 orderId) internal returns (bool) {
        Order memory order = orders[orderId];
        for (uint i = 0; i < pendingOrderIds.length; i++) {
            if (pendingOrderIds[i] == orderId) {
                //remove from pending array
                pendingOrderIds = ArrayMutation.removeFromArray(
                    i,
                    pendingOrderIds
                );
                order.tokenIn.safeTransfer(order.recipient, order.amountIn);

                //emit event
                emit OrderCancelled(orderId);

                //short circuit loop
                return true;
            }
        }
        return false;
    }

    ///@return upkeepNeeded is true only when there is a stop-limit order to fill
    ///@return performData should be passed unaltered to performUpkeep
    function checkUpkeep(
        bytes calldata
    )
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        for (uint256 i = 0; i < pendingOrderIds.length; i++) {
            Order memory order = orders[pendingOrderIds[i]];
            (bool inRange, uint256 exchangeRate) = checkInRange(order);
            if (inRange) {
                return (
                    true,
                    abi.encode(
                        MasterUpkeepData({
                            orderType: OrderType.STOP_LIMIT,
                            target: address(0x0), //N/A
                            txData: "0x", //N/A
                            pendingOrderIdx: i,
                            orderId: order.orderId,
                            tokenIn: order.tokenIn,
                            tokenOut: order.tokenOut,
                            bips: order.swapSlippage,
                            amountIn: order.amountIn,
                            exchangeRate: exchangeRate
                        })
                    )
                );
            }
        }
    }

    ///@param performData can simply be passed from return of checkUpkeep without alteration
    function performUpkeep(bytes calldata performData) external override {
        MasterUpkeepData memory data = abi.decode(
            performData,
            (MasterUpkeepData)
        );
        Order memory order = orders[pendingOrderIds[data.pendingOrderIdx]];

        //confirm order is in range to prevent improper fill
        (bool inRange, ) = checkInRange(order);
        require(inRange, "order ! in range");

        //remove from pending array
        pendingOrderIds = ArrayMutation.removeFromArray(
            data.pendingOrderIdx,
            pendingOrderIds
        );

        //approve
        updateApproval(address(SLL_CONTRACT), order.tokenIn, order.amountIn);

        if (order.swapOnFill) {
            //for swap on fill, we expect to be paid out in the same asset we provided
            //so the resulting order tokenIn and tokenOut are inverted relative to our original swap limit order
            SwapParams memory params = SwapParams({
                swapTokenIn: order.tokenIn,//asset provided
                swapAmountIn: order.amountIn,
                swapTarget: data.target,
                swapBips: order.swapSlippage,
                txData: data.txData
            });
            SLL_CONTRACT.createOrderWithSwap(
                params,
                order.strikePrice,
                order.stopPrice,
                order.tokenOut,//invert tokenIn 
                order.tokenIn,//invert tokenOut
                order.recipient,
                order.strikeSlippage,
                order.stopSlippage
            );

        } else {
            SLL_CONTRACT.createOrder(
                order.strikePrice,
                order.stopPrice,
                order.amountIn,
                order.tokenIn,
                order.tokenOut,
                order.recipient,
                order.strikeSlippage,
                order.stopSlippage
            );
        }

        emit StopLimitOrderProcessed(order.orderId);
    }

    ///@notice if current approval is insufficient, approve max
    ///@notice oz safeIncreaseAllowance controls for tokens that require allowance to be reset to 0 before increasing again
    function updateApproval(
        address spender,
        IERC20 token,
        uint256 amount
    ) internal {
        // get current allowance
        uint256 currentAllowance = token.allowance(address(this), spender);
        if (currentAllowance < amount) {
            // amount is a delta, so need to pass max - current to avoid overflow
            token.safeIncreaseAllowance(
                spender,
                type(uint256).max - currentAllowance
            );
        }
    }

    function checkInRange(
        Order memory order
    ) internal view returns (bool inRange, uint256 exchangeRate) {
        exchangeRate = MASTER.getExchangeRate(order.tokenIn, order.tokenOut);
        if (order.direction) {
            if (exchangeRate <= order.stopLimitPrice) {
                inRange = true;
            }
        } else {
            if (exchangeRate >= order.stopLimitPrice) {
                inRange = true;
            }
        }
    }
}
