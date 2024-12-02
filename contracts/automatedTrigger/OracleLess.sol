// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
import "../interfaces/openzeppelin/Ownable.sol";
import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/openzeppelin/SafeERC20.sol";
import "../interfaces/openzeppelin/ReentrancyGuard.sol";
import "./AutomationMaster.sol";
import "../libraries/ArrayMutation.sol";

//testing 
import "hardhat/console.sol";

contract OracleLess is IOracleLess, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    AutomationMaster public immutable MASTER;
    IPermit2 public immutable permit2;

    uint96[] public pendingOrderIds;

    mapping(uint96 => Order) public orders;

    constructor(AutomationMaster _master, IPermit2 _permit2) {
        MASTER = _master;
        permit2 = _permit2;
    }

    ///@return pendingOrders a full list of all pending orders with full order details
    ///@notice this should not be called in a write function due to gas usage
    function getPendingOrders()
        external
        view
        returns (Order[] memory pendingOrders)
    {
        pendingOrders = new Order[](pendingOrderIds.length);
        for (uint96 i = 0; i < pendingOrderIds.length; i++) {
            Order memory order = orders[pendingOrderIds[i]];
            pendingOrders[i] = order;
        }
    }

    function createOrder(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient,
        uint16 feeBips,
        bool permit,
        bytes calldata permitPayload
    ) external override returns (uint96 orderId) {
        //procure tokens
        procureTokens(tokenIn, amountIn, recipient, permit, permitPayload);

        //construct and store order
        orderId = MASTER.generateOrderId(recipient);
        orders[orderId] = Order({
            orderId: orderId,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            exchangeRate: deduceExchangeRate(amountIn, minAmountOut),
            recipient: recipient,
            feeBips: feeBips
        });

        //store pending order
        pendingOrderIds.push(orderId);

        emit OrderCreated(orderId);
    }

    function adminCancelOrder(uint96 orderId) external onlyOwner {
        Order memory order = orders[orderId];
        require(_cancelOrder(order), "Order not active");
    }

    function cancelOrder(uint96 orderId) external override {
        Order memory order = orders[orderId];
        require(msg.sender == order.recipient, "Only Order Owner");
        require(_cancelOrder(order), "Order not active");
    }

    function modifyOrder(
        uint96 orderId,
        IERC20 _tokenOut,
        uint256 amountInDelta,
        uint256 _minAmountOut,
        address _recipient,
        bool increasePosition,
        bool permit,
        bytes calldata permitPayload
    ) external override {
        (Order memory order, uint256 newAmountIn) = _settleModifiedOrder(
            orderId,
            _tokenOut,
            amountInDelta,
            _minAmountOut,
            _recipient,
            increasePosition,
            permit,
            permitPayload
        );
        _modifyOrder(order, _tokenOut, newAmountIn, _minAmountOut, _recipient);

        emit OrderModified(orderId);
    }

    //todo nonreentrant
    ///@notice fill entire order
    function fillOrder(
        uint96 pendingOrderIdx,
        uint96 orderId,
        address target,
        bytes calldata txData
    ) external override {
        //fetch order
        Order memory order = orders[orderId];
        console.log("tokenIn: ", address(order.tokenIn));
        console.log("tokenOut: ", address(order.tokenOut));

        require(
            order.orderId == pendingOrderIds[pendingOrderIdx],
            "Order Fill Mismatch"
        );

        //perform swap
        (uint256 amountOut, uint256 tokenInRefund) = execute(
            target,
            txData,
            order
        );
        //verify exchange rate
        uint256 effectiveExchangeRate = deduceExchangeRate(
            order.amountIn - tokenInRefund,
            amountOut
        );
        require(
            effectiveExchangeRate >= order.exchangeRate,
            "Too little received"
        );

        if (amountOut >= order.minAmountOut) {
            //fill and close
            pendingOrderIds = ArrayMutation.removeFromArray(
                pendingOrderIdx,
                pendingOrderIds
            );

            //refund any unspent tokenIn
            //this should generally be 0 when using exact input for swaps, which is recommended
            if (tokenInRefund != 0) {
                order.tokenIn.safeTransfer(order.recipient, tokenInRefund);
            }
            emit OrderFilled(order.orderId);
        } else if (amountOut < order.minAmountOut) {
            //partial fill - modify order
            _modifyOrder(
                order,
                order.tokenOut,
                (order.amountIn - tokenInRefund),
                (order.minAmountOut - amountOut),
                order.recipient
            );
            emit OrderPartiallyFilled(order.orderId);
        }

        //handle fee
        (uint256 feeAmount, uint256 adjustedAmount) = applyFee(
            amountOut,
            order.feeBips
        );
        if (feeAmount != 0) {
            order.tokenOut.safeTransfer(address(MASTER), feeAmount);
        }

        //send tokenOut to recipient
        order.tokenOut.safeTransfer(order.recipient, adjustedAmount);
    }

    function _cancelOrder(Order memory order) internal returns (bool) {
        for (uint96 i = 0; i < pendingOrderIds.length; i++) {
            if (pendingOrderIds[i] == order.orderId) {
                //remove from pending array
                pendingOrderIds = ArrayMutation.removeFromArray(
                    i,
                    pendingOrderIds
                );

                //refund tokenIn amountIn to recipient
                order.tokenIn.safeTransfer(order.recipient, order.amountIn);

                //emit event
                emit OrderCancelled(order.orderId);

                return true;
            }
        }
        return false;
    }

    function _settleModifiedOrder(
        uint96 orderId,
        IERC20 _tokenOut,
        uint256 amountInDelta,
        uint256 _minAmountOut,
        address _recipient,
        bool increasePosition,
        bool permit,
        bytes calldata permitPayload
    ) internal returns (Order memory order, uint256 newAmountIn) {
        //fetch order
        order = orders[orderId];

        require(msg.sender == order.recipient, "only order owner");

        //deduce any amountIn changes
        newAmountIn = order.amountIn;
        if (amountInDelta != 0) {
            if (increasePosition) {
                //take more tokens from order recipient
                newAmountIn += amountInDelta;
                procureTokens(
                    order.tokenIn,
                    amountInDelta,
                    order.recipient,
                    permit,
                    permitPayload
                );
            } else {
                //refund some tokens
                //ensure delta is valid
                require(amountInDelta < order.amountIn, "invalid delta");

                //set new amountIn for accounting
                newAmountIn -= amountInDelta;

                //refund position partially
                order.tokenIn.safeTransfer(order.recipient, amountInDelta);
            }
        }
        _modifyOrder(order, _tokenOut, newAmountIn, _minAmountOut, _recipient);
    }

    function _modifyOrder(
        Order memory order,
        IERC20 _tokenOut,
        uint256 newAmountIn,
        uint256 _minAmountOut,
        address _recipient
    ) internal {
        //construct new order
        Order memory newOrder = Order({
            orderId: order.orderId,
            tokenIn: order.tokenIn,
            tokenOut: _tokenOut,
            amountIn: newAmountIn,
            minAmountOut: _minAmountOut,
            exchangeRate: deduceExchangeRate(newAmountIn, _minAmountOut),
            feeBips: order.feeBips,
            recipient: _recipient
        });

        //store new order
        orders[order.orderId] = newOrder;
    }

    function execute(
        address target,
        bytes calldata txData,
        Order memory order
    ) internal returns (uint256 amountOut, uint256 tokenInRefund) {
        //update accounting
        uint256 initialTokenIn = order.tokenIn.balanceOf(address(this));
        uint256 initialTokenOut = order.tokenOut.balanceOf(address(this));

        //approve
        order.tokenIn.safeApprove(target, order.amountIn);

        //perform the call
        (bool success, bytes memory reason) = target.call(txData);
        console.log("SUCCESS: ", success);
        if (!success) {
            revert TransactionFailed(reason);
        }

        uint256 finalTokenIn = order.tokenIn.balanceOf(address(this));
        require(finalTokenIn >= initialTokenIn - order.amountIn, "over spend");
        uint256 finalTokenOut = order.tokenOut.balanceOf(address(this));

        amountOut = finalTokenOut - initialTokenOut;
        tokenInRefund = order.amountIn - (initialTokenIn - finalTokenIn);
    }

    /**
    3000 USDCs in for 1 eth out = 3000 / 1 or 3k USDC per ETH
     */
    function deduceExchangeRate(
        uint256 amountIn,
        uint256 amountOut
    ) internal pure returns (uint256 exchangeRate) {
        exchangeRate = amountIn / amountOut;
    }

    function procureTokens(
        IERC20 token,
        uint256 amount,
        address owner,
        bool permit,
        bytes calldata permitPayload
    ) internal {
        if (permit) {
            IAutomation.Permit2Payload memory payload = abi.decode(
                permitPayload,
                (IAutomation.Permit2Payload)
            );

            permit2.permit(owner, payload.permitSingle, payload.signature);
            permit2.transferFrom(
                owner,
                address(this),
                uint160(amount),
                address(token)
            );
        } else {
            token.safeTransferFrom(owner, address(this), amount);
        }
    }

    ///@notice apply the protocol fee to @param amount
    ///@notice fee is in the form of tokenOut after a successful performUpkeep
    function applyFee(
        uint256 amount,
        uint16 feeBips
    ) internal pure returns (uint256 feeAmount, uint256 adjustedAmount) {
        if (feeBips != 0) {
            //determine adjusted amount and fee amount
            adjustedAmount = (amount * (10000 - feeBips)) / 10000;
            feeAmount = amount - adjustedAmount;
        } else {
            return (0, amount);
        }
    }
}
