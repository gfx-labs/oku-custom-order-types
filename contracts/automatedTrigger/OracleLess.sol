// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;
import "./AutomationMaster.sol";
import "../interfaces/openzeppelin/Ownable.sol";
import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/openzeppelin/ERC20.sol";
import "../interfaces/openzeppelin/SafeERC20.sol";
import "../interfaces/openzeppelin/ReentrancyGuard.sol";
import "../interfaces/openzeppelin/Pausable.sol";
import "../interfaces/openzeppelin/EnumerableSet.sol";
import "../libraries/ArrayMutation.sol";

contract OracleLess is IOracleLess, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;

    AutomationMaster public immutable MASTER;
    IPermit2 public immutable permit2;

    uint96 public orderCount;

    uint96[] public pendingOrderIds;

    mapping(uint96 => Order) public orders;
    EnumerableSet.UintSet private dataSet;

    constructor(AutomationMaster _master, IPermit2 _permit2, address owner) {
        MASTER = _master;
        permit2 = _permit2;
        _transferOwnership(owner);
    }

    modifier paysFee() {
        uint256 orderFee = MASTER.orderFee();
        require(msg.value >= orderFee, "Insufficient funds for order fee");
        _;
        // Transfer the fee to the contract owner
        payable(address(MASTER)).transfer(orderFee);
    }

    function pause(bool __pause) external override {
        require(
            msg.sender == address(MASTER) || msg.sender == owner(),
            "Not Authorized"
        );
        if (__pause) {
            _pause();
        } else {
            _unpause();
        }
    }

    function getPendingOrders()
        external
        view
        returns (Order[] memory pendingOrders)
    {
        pendingOrders = new Order[](dataSet.length());
        for (uint256 i; i < dataSet.length(); i++) {
            pendingOrders[i] = orders[uint96(dataSet.at(i))];
        }
    }

    function getSpecificPendingOrders(
        uint256 start,
        uint256 count
    ) external view returns (Order[] memory) {
        // Validate start and count
        uint256 end = start + count;
        if (end > dataSet.length()) {
            end = dataSet.length();
        }

        Order[] memory ordersSubset = new Order[](end - start);
        for (uint256 i = start; i < end; i++) {
            ordersSubset[i - start] = orders[uint96(dataSet.at(i))];
        }
        return ordersSubset;
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
    )
        external
        payable
        override
        paysFee
        nonReentrant
        whenNotPaused
        returns (uint96 orderId)
    {
        require(amountIn != 0, "amountIn == 0");
        require(tokenIn != tokenOut, "tokenIn == tokenOut");
        require(feeBips <= 10000, "BIPS > 10k");
        require(recipient != address(0x0), "recipient == zero address");

        //procure tokens
        procureTokens(tokenIn, amountIn, msg.sender, permit, permitPayload);

        //construct and store order
        orderId = MASTER.generateOrderId(msg.sender);
        orders[orderId] = Order({
            orderId: orderId,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            recipient: recipient,
            feeBips: feeBips
        });

        //store pending order
        dataSet.add(orderId);

        orderCount++;

        emit OrderCreated(orderId, orderCount);
    }

    ///@notice allow administrator to cancel any order
    ///@notice once cancelled, any funds assocaiated with the order are returned to the order recipient
    ///@notice only pending orders can be cancelled
    function adminCancelOrder(uint96 orderId) external onlyOwner nonReentrant {
        Order memory order = orders[orderId];
        _cancelOrder(order);
    }

    ///@notice only the order recipient can cancel their order
    ///@notice only pending orders can be cancelled
    function cancelOrder(uint96 orderId) external nonReentrant whenNotPaused {
        Order memory order = orders[orderId];
        require(msg.sender == order.recipient, "Only Order Owner");
        _cancelOrder(order);
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
    ) external payable override nonReentrant paysFee whenNotPaused {
        require(dataSet.contains(orderId), "order not active");
        require(_recipient != address(0x0), "recipient == zero address");

        _modifyOrder(
            orderId,
            _tokenOut,
            amountInDelta,
            _minAmountOut,
            _recipient,
            increasePosition,
            permit,
            permitPayload
        );
        emit OrderModified(orderId);
    }

    function fillOrder(
        uint96 pendingOrderIdx,
        uint96 orderId,
        address target,
        bytes calldata txData
    ) external override nonReentrant whenNotPaused {
        //validate target
        MASTER.validateTarget(target);

        //fetch order
        Order memory order = orders[orderId];

        require(
            order.orderId == uint96(dataSet.at(pendingOrderIdx)),
            "Order Fill Mismatch"
        );

        //perform swap
        (uint256 amountOut, uint256 tokenInRefund) = execute(
            target,
            txData,
            order
        );

        //handle accounting
        //remove from pending dataSet
        dataSet.remove(order.orderId);

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

        //refund any unspent tokenIn
        //this should generally be 0 when using exact input for swaps, which is recommended
        if (tokenInRefund != 0) {
            order.tokenIn.safeTransfer(order.recipient, tokenInRefund);
        }
    }

    function _cancelOrder(Order memory order) internal {
        //remove from pending set
        dataSet.remove(order.orderId);

        //refund tokenIn amountIn to recipient
        order.tokenIn.safeTransfer(order.recipient, order.amountIn);

        //emit event
        emit OrderCancelled(order.orderId);
    }

    function _modifyOrder(
        uint96 orderId,
        IERC20 _tokenOut,
        uint256 amountInDelta,
        uint256 _minAmountOut,
        address _recipient,
        bool increasePosition,
        bool permit,
        bytes calldata permitPayload
    ) internal {
        //fetch order
        Order memory order = orders[orderId];
        require(dataSet.contains(orderId), "order not active");
        require(msg.sender == order.recipient, "only order owner");

        require(order.tokenIn != _tokenOut, "tokenIn == tokenOut");

        //deduce any amountIn changes
        uint256 newAmountIn = order.amountIn;
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
            require(newAmountIn != 0, "newAmountIn == 0");
        }

        //construct new order
        Order memory newOrder = Order({
            orderId: orderId,
            tokenIn: order.tokenIn,
            tokenOut: _tokenOut,
            amountIn: newAmountIn,
            minAmountOut: _minAmountOut,
            feeBips: order.feeBips,
            recipient: _recipient
        });

        //store new order
        orders[orderId] = newOrder;
    }

    function execute(
        address target,
        bytes calldata txData,
        Order memory order
    ) internal returns (uint256 amountOut, uint256 tokenInRefund) {
        //update accounting
        uint256 initialTokenIn = order.tokenIn.balanceOf(address(this));
        uint256 initialTokenOut = order.tokenOut.balanceOf(address(this));

        //approve 0
        order.tokenIn.safeDecreaseAllowance(
            target,
            (order.tokenIn.allowance(address(this), target))
        );

        //approve
        order.tokenIn.safeIncreaseAllowance(target, order.amountIn);

        //perform the call
        (bool success, bytes memory reason) = target.call(txData);

        if (!success) {
            revert TransactionFailed(reason);
        }

        //approve 0
        order.tokenIn.safeDecreaseAllowance(
            target,
            (order.tokenIn.allowance(address(this), target))
        );

        uint256 finalTokenIn = order.tokenIn.balanceOf(address(this));
        require(finalTokenIn >= initialTokenIn - order.amountIn, "over spend");
        uint256 finalTokenOut = order.tokenOut.balanceOf(address(this));

        require(
            finalTokenOut - initialTokenOut > order.minAmountOut,
            "Too Little Received"
        );

        amountOut = finalTokenOut - initialTokenOut;
        tokenInRefund = order.amountIn - (initialTokenIn - finalTokenIn);
    }

    function procureTokens(
        IERC20 token,
        uint256 amount,
        address owner,
        bool permit,
        bytes calldata permitPayload
    ) internal {
        if (permit) {
            require(amount < type(uint160).max, "uint160 overflow");

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
