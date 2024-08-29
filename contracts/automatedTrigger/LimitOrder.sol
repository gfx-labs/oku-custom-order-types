// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "./IAutomation.sol";
import "./AutomationMaster.sol";
import "../interfaces/chainlink/AutomationCompatibleInterface.sol";
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
contract LimitOrder is Ownable, ILimitOrder, AutomationCompatibleInterface {
    using SafeERC20 for IERC20;


    AutomationMaster public immutable MASTER;

    uint256 public limitOrderCount;

    uint256[] public PendingOrderIds;

    mapping(uint256 => Order) public limitOrders;


    constructor(AutomationMaster _master){
        MASTER = _master;
    }

    

    function getPendingOrders()
        external
        view
        returns (uint256[] memory pendingOrderIds)
    {
        return PendingOrderIds;
    }

    

    ///@param strikePrice is in terms of exchange rate of tokenIn / tokenOut
    function createOrder(
        uint256 strikePrice,
        uint256 amountIn,
        uint256 pairId,
        address recipient,
        uint80 slippageBips,
        bool zeroForOne
    ) external override{
        //we assume oracles exist if the pair exists
        (IERC20 tokenIn, IERC20 tokenOut) = MASTER.deducePair(pairId, zeroForOne);
       
        require(limitOrderCount < MASTER.maxPendingOrders(), "Max Order Count Reached");

        require(slippageBips <= MASTER.MAX_BIPS(), "Invalid Slippage BIPS");

        //verify order amount is at least the minimum
        MASTER.checkMinOrderSize(tokenIn, amountIn);

        limitOrderCount++;
        limitOrders[limitOrderCount] = Order({
            orderId: limitOrderCount,
            strikePrice: strikePrice,
            amountIn: amountIn,
            slippageBips: slippageBips,
            pairId: pairId,
            recipient: recipient,
            zeroForOne: zeroForOne,
            direction: MASTER.getExchangeRate(pairId) > strikePrice //exchangeRate in/out > strikePrice
        });
        PendingOrderIds.push(limitOrderCount);

        //take asset
        tokenIn.safeTransferFrom(recipient, address(this), amountIn);

        //emit
        emit OrderCreated(limitOrderCount);
    }

    function adminCancelOrder(uint256 orderId) external onlyOwner {
        _cancelOrder(orderId);
    }

    ///@notice only the order recipient can cancel their order
    ///@notice only pending orders can be cancelled
    function cancelOrder(uint256 orderId) external {
        Order memory order = limitOrders[orderId];

        require(msg.sender == order.recipient, "Only Order Owner");
        require(_cancelOrder(orderId), "Order not active");
    }

    function _cancelOrder(uint256 orderId) internal returns (bool) {
        Order memory order = limitOrders[orderId];
        for (uint i = 0; i < PendingOrderIds.length; i++) {
            if (PendingOrderIds[i] == orderId) {
                //remove from pending array
                PendingOrderIds = ArrayMutation.removeFromArray(
                    i,
                    PendingOrderIds
                );

                //refund tokens
                (IERC20 tokenIn, ) = MASTER.deducePair(
                    order.pairId,
                    order.zeroForOne
                );
                tokenIn.safeTransfer(order.recipient, order.amountIn);

                //emit event
                emit OrderCancelled(orderId);

                //short circuit loop
                return true;
            }
        }
        return false;
    }

    

    //check upkeep
    function checkUpkeep(
        bytes calldata /**checkData */
    )
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        for (uint i = 0; i < PendingOrderIds.length; i++) {
            Order memory order = limitOrders[PendingOrderIds[i]];
            uint256 exchangeRate = MASTER.getExchangeRate(order.pairId);
            if (order.direction) {
                if (exchangeRate <= order.strikePrice) {
                    return (
                        true,
                        abi.encode(
                            UpkeepData({pendingOrderIdx: i, order: order, exchangeRate: exchangeRate})
                        )
                    );
                }
            } else {
                if (exchangeRate >= order.strikePrice) {
                    return (
                        true,
                        abi.encode(
                            UpkeepData({pendingOrderIdx: i, order: order, exchangeRate: exchangeRate})
                        )
                    );
                }
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
        (address target, uint256 pendingOrderIdx, bytes memory txData) = abi
            .decode(performData, (address, uint256, bytes));
        Order memory order = limitOrders[PendingOrderIds[pendingOrderIdx]];
        (IERC20 tokenIn, IERC20 tokenOut) = MASTER.deducePair(
            order.pairId,
            order.zeroForOne
        );
        //update accounting
        uint256 initialTokenOut = tokenOut.balanceOf(address(this));

        //approve
        updateApproval(target, tokenIn, order.amountIn);

        //perform the call
        (bool success, bytes memory result) = target.call(txData);

        if (success) {
            uint256 finalTokenOut = tokenOut.balanceOf(address(this));

            //if success, we expect tokenIn balance to decrease by amountIn
            //and tokenOut balance to increase by at least minAmountReceived
            require(
                finalTokenOut - initialTokenOut >
                    MASTER.getMinAmountReceived(
                        order.pairId,
                        order.zeroForOne,
                        order.slippageBips,
                        order.amountIn
                    ),
                "Too Little Received"
            );

            //remove from pending array
            PendingOrderIds = ArrayMutation.removeFromArray(
                pendingOrderIdx,
                PendingOrderIds
            );

            //send tokenOut to recipient
            tokenOut.safeTransfer(
                order.recipient,
                finalTokenOut - initialTokenOut
            );
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


    

    
}
