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
contract LimitOrder is Ownable, ILimitOrder {
    using SafeERC20 for IERC20;

    AutomationMaster public immutable MASTER;

    uint256 public limitOrderCount;

    uint256[] public PendingOrderIds;

    mapping(uint256 => Order) public limitOrders;

    constructor(AutomationMaster _master) {
        MASTER = _master;
    }

    function getPendingOrders()
        external
        view
        returns (uint256[] memory pendingOrderIds)
    {
        return PendingOrderIds;
    }

    ///@param strikePrice is in terms of exchange rate of tokenIn / tokenOut,
    /// thus is dependent on direction
    function createOrder(
        uint256 strikePrice,
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address recipient,
        uint88 slippageBips
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
            limitOrderCount < MASTER.maxPendingOrders(),
            "Max Order Count Reached"
        );
        require(slippageBips <= MASTER.MAX_BIPS(), "Invalid Slippage BIPS");

        //verify order amount is at least the minimum todo check here or only when limit order is created?
        MASTER.checkMinOrderSize(tokenIn, amountIn);

        limitOrderCount++;
        limitOrders[limitOrderCount] = Order({
            orderId: limitOrderCount,
            strikePrice: strikePrice,
            amountIn: amountIn,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            recipient: recipient,
            slippageBips: slippageBips,
            direction: MASTER.getExchangeRate(tokenIn, tokenOut) > strikePrice //exchangeRate in/out > strikePrice
        });
        PendingOrderIds.push(limitOrderCount);

        //take asset from msg.sender note not from recipient
        //this allows us to create orders on behalf of a different addr
        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);

        //emit
        emit OrderCreated(limitOrderCount);
    }

    function adminCancelOrder(uint256 orderId) external onlyOwner {
        Order memory order = limitOrders[orderId];
        require(_cancelOrder(order), "Order not active");
    }

    ///@notice only the order recipient can cancel their order
    ///@notice only pending orders can be cancelled
    function cancelOrder(uint256 orderId) external {
        Order memory order = limitOrders[orderId];
        require(msg.sender == order.recipient, "Only Order Owner");
        require(_cancelOrder(order), "Order not active");
    }

    function _cancelOrder(Order memory order) internal returns (bool) {
        for (uint i = 0; i < PendingOrderIds.length; i++) {
            if (PendingOrderIds[i] == order.orderId) {
                //remove from pending array
                PendingOrderIds = ArrayMutation.removeFromArray(
                    i,
                    PendingOrderIds
                );

                //refund tokenIn amountIn to recipient
                order.tokenIn.safeTransfer(order.recipient, order.amountIn);

                //emit event
                emit OrderCancelled(order.orderId);

                //short circuit loop
                return true;
            }
        }
        return false;
    }

    //check upkeep
    function checkUpkeep(
        bytes calldata
    )
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        for (uint i = 0; i < PendingOrderIds.length; i++) {
            Order memory order = limitOrders[PendingOrderIds[i]];
            (bool inRange, uint256 exchangeRate) = checkInRange(order);
            if (inRange) {
                return (
                    true,
                    abi.encode(
                        MasterUpkeepData({
                            orderType: OrderType.LIMIT,
                            target: address(0x0),
                            txData: "0x",
                            pendingOrderIdx: i,
                            orderId: order.orderId,
                            tokenIn: order.tokenIn,
                            tokenOut: order.tokenOut,
                            bips: order.slippageBips,
                            amountIn: order.amountIn,
                            exchangeRate: exchangeRate
                        })
                    )
                );
            }
        }
    }

    //perform upkeep - todo onlyOwner or verify sender?
    ///@notice recipient of swap should be this contract,
    ///as we need to account for tokens received.
    ///This contract will then forward the tokens to the user
    /// target refers to some contract where when we send @param performData,
    ///that contract will exchange our tokenIn for tokenOut with at least minAmountReceived
    /// pendingOrderIdx is the index of the pending order we are executing,
    ///this pending order is removed from the array via array mutation
    function performUpkeep(bytes calldata performData) external override {
        MasterUpkeepData memory data = abi.decode(
            performData,
            (MasterUpkeepData)
        );

        //need to make sure we are removing the correct pending order from the array, 
        //theoreticly, any data can be passed to this function and we shouldn't trust it
        require(PendingOrderIds[data.pendingOrderIdx] == data.orderId, "Valid order");
        Order memory order = limitOrders[PendingOrderIds[data.pendingOrderIdx]];

        //confirm order is in range to prevent improper fill
        (bool inRange, ) = checkInRange(order);
        require(inRange, "order ! in range");

        //update accounting
        uint256 initialTokenIn = order.tokenIn.balanceOf(address(this));
        uint256 initialTokenOut = order.tokenOut.balanceOf(address(this));

        //todo use approval as a mechanism in order to prevent use of unauthorized funds? 
        //if so, need to reset approval to 0 first and then approve only the order.amountIn - not the most efficient
        //approve
        updateApproval(data.target, order.tokenIn, order.amountIn);

        //perform the call
        (bool success, bytes memory result) = data.target.call(data.txData);
        if (success) {
            uint256 finalTokenIn = order.tokenIn.balanceOf(address(this));
            require(finalTokenIn >= initialTokenIn - order.amountIn, "over spend");

            uint256 finalTokenOut = order.tokenOut.balanceOf(address(this));

            //if success, we expect tokenIn balance to decrease by amountIn
            //and tokenOut balance to increase by at least minAmountReceived
            require(
                finalTokenOut - initialTokenOut >
                    MASTER.getMinAmountReceived(
                        order.amountIn,
                        order.tokenIn,
                        order.tokenOut,
                        order.slippageBips
                    ),
                "Too Little Received"
            );

            //todo//console.log("Amount Received: ", finalTokenOut - initialTokenOut); //todo by changing the uni tx data, 5599907018 => 7296655519

            //remove from pending array
            PendingOrderIds = ArrayMutation.removeFromArray(
                data.pendingOrderIdx,
                PendingOrderIds
            );
            //send tokenOut to recipient
            order.tokenOut.safeTransfer(
                order.recipient,
                finalTokenOut - initialTokenOut
            );

            //refund any tokenIn remianing
            //should generally be 0, exactInput for tokenIn should be used for swaps where possible
            if(finalTokenIn != initialTokenIn - order.amountIn){
                order.tokenIn.safeTransfer(
                    order.recipient,
                    order.amountIn - (initialTokenIn - finalTokenIn)
                );
            }
        }
        //emit
        emit OrderProcessed(order.orderId, success, result);
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
            if (exchangeRate <= order.strikePrice) {
                inRange = true;
            }
        } else {
            if (exchangeRate >= order.strikePrice) {
                inRange = true;
            }
        }
    }
}
