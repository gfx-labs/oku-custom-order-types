// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "./IAutomation.sol";
import "./AutomationMaster.sol";
//import "../interfaces/chainlink/AutomationCompatibleInterface.sol";
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

///@notice This contract owns and handles all logic associated with STOP_MARKET orders
///@notice STOP_MARKET orders check an external oracle for a pre-determined strike price,
///once this price is reached, a market swap occurs
contract StopLimit is Ownable, IStopLimit {
    using SafeERC20 for IERC20;

    AutomationMaster public immutable MASTER;
    ILimitOrder public immutable LIMIT_ORDER_CONTRACT;

    uint256 public stopOrderCount;

    uint256[] public PendingOrderIds;

    mapping(uint256 => Order) public stopLimitOrders;

    constructor(AutomationMaster _master, ILimitOrder _limitOrder) {
        MASTER = _master;
        LIMIT_ORDER_CONTRACT = _limitOrder;
    }

    function getPendingOrders()
        external
        view
        returns (uint256[] memory pendingOrderIds)
    {
        return PendingOrderIds;
    }

    ///@param stopPrice price at which the limit order is created
    ///@param strikePrice price at which the limit order is closed
    function createOrder(
        uint256 stopPrice,
        uint256 strikePrice,
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address recipient,
        uint80 slippageBips
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
            stopOrderCount < MASTER.maxPendingOrders(),
            "Max Order Count Reached"
        );
        require(slippageBips <= MASTER.MAX_BIPS(), "Invalid Slippage BIPS");

        //verify order amount is at least the minimum todo check here or only when limit order is created?
        MASTER.checkMinOrderSize(tokenIn, amountIn);

        stopOrderCount++;
        stopLimitOrders[stopOrderCount] = Order({
            orderId: stopOrderCount,
            stopPrice: stopPrice,
            strikePrice: strikePrice,
            amountIn: amountIn,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            slippageBips: slippageBips,
            recipient: recipient,
            direction: MASTER.getExchangeRate(tokenIn, tokenOut) > stopPrice //compare to stop price for this order's direction
        });
        PendingOrderIds.push(stopOrderCount);

        //take asset
        tokenIn.safeTransferFrom(recipient, address(this), amountIn);

        //emit
        emit OrderCreated(stopOrderCount);
    }

    function adminCancelOrder(uint256 orderId) external onlyOwner {
        _cancelOrder(orderId);
    }

    ///@notice only the order recipient can cancel their order
    ///@notice only pending orders can be cancelled
    function cancelOrder(uint256 orderId) external {
        Order memory order = stopLimitOrders[orderId];
        require(msg.sender == order.recipient, "Only Order Owner");
        require(_cancelOrder(orderId), "Order not active");
    }

    function _cancelOrder(uint256 orderId) internal returns (bool) {
        Order memory order = stopLimitOrders[orderId];
        for (uint i = 0; i < PendingOrderIds.length; i++) {
            if (PendingOrderIds[i] == orderId) {
                //remove from pending array
                PendingOrderIds = ArrayMutation.removeFromArray(
                    i,
                    PendingOrderIds
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
        bytes calldata /**checkData */
    )
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        for (uint256 i = 0; i < PendingOrderIds.length; i++) {
            Order memory order = stopLimitOrders[PendingOrderIds[i]];
            (bool inRange, uint256 exchangeRate) = checkInRange(order);
            if (inRange) {
                return (
                    true,
                    abi.encode(
                        MasterUpkeepData({
                            orderType: OrderType.STOP_LIMIT,
                            target: address(0x0),
                            txData: "0x",
                            pendingOrderIdx: i,
                            tokenIn: order.tokenIn,
                            tokenOut: order.tokenOut,
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
        Order memory order = stopLimitOrders[
            PendingOrderIds[data.pendingOrderIdx]
        ];

        //confirm order is in range to prevent improper fill
        (bool inRange, ) = checkInRange(order);
        require(inRange, "order ! in range");

        //remove from pending array
        PendingOrderIds = ArrayMutation.removeFromArray(
            data.pendingOrderIdx,
            PendingOrderIds
        );

        //approve
        updateApproval(
            address(LIMIT_ORDER_CONTRACT),
            order.tokenIn,
            order.amountIn
        );

        LIMIT_ORDER_CONTRACT.createOrder(
            order.strikePrice,
            order.amountIn,
            order.tokenIn,
            order.tokenOut,
            order.recipient,
            order.slippageBips
        );
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
            if (exchangeRate <= order.stopPrice) {
                inRange = true;
            }
        } else {
            if (exchangeRate >= order.stopPrice) {
                inRange = true;
            }
        }
    }
}
