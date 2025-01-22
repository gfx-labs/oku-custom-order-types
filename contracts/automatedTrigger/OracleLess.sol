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

contract OracleLess is IOracleLess, Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;
    using EnumerableSet for EnumerableSet.AddressSet;

    AutomationMaster public immutable MASTER;
    IPermit2 public immutable permit2;

    uint96 public orderCount;

    uint96[] public pendingOrderIds;

    mapping(uint96 => Order) public orders;
    mapping(IERC20 => bool) public whitelistedTokens;
    EnumerableSet.AddressSet private uniqueTokens;
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

    function whitelistTokens(
        IERC20[] calldata tokens,
        bool[] calldata approved
    ) external onlyOwner {
        require(tokens.length == approved.length, "array mismatch");

        for (uint i = 0; i < tokens.length; i++) {
            IERC20 token = tokens[i];
            bool isApproved = approved[i];

            whitelistedTokens[token] = isApproved;

            if (isApproved) {
                // Add to the unique token set if approved
                uniqueTokens.add(address(token));
            } else {
                // Remove from the unique token set if not approved
                uniqueTokens.remove(address(token));
            }
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
        require(
            whitelistedTokens[tokenIn] && whitelistedTokens[tokenOut],
            "tokens not whitelisted"
        );

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
    ///NOTE if @param refund is false, then the order's tokens will not be refunded and will be stuck on this contract possibly forever
    ///@notice ONLY SET @param refund TO FALSE IN THE CASE OF A BROKEN ORDER CAUSING cancelOrder() TO REVERT
    function adminCancelOrder(
        uint96 orderId,
        bool refund
    ) external onlyOwner nonReentrant {
        Order memory order = orders[orderId];
        _cancelOrder(order, refund);
    }

    ///@notice only the order recipient can cancel their order
    ///@notice only pending orders can be cancelled
    function cancelOrder(uint96 orderId) external nonReentrant whenNotPaused {
        Order memory order = orders[orderId];
        require(msg.sender == order.recipient, "Only Order Owner");
        _cancelOrder(order, true);
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

    function _cancelOrder(Order memory order, bool refund) internal {
        //remove from pending set
        dataSet.remove(order.orderId);

        //refund tokenIn amountIn to recipient
        if (refund) {
            order.tokenIn.safeTransfer(order.recipient, order.amountIn);
        }
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
        require(whitelistedTokens[_tokenOut], "token not whitelisted");

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
        uint256[] memory initBalances = verifyTokenBalances(
            new uint256[](0),
            order.tokenIn,
            order.tokenOut
        );

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
        verifyTokenBalances(initBalances, order.tokenIn, order.tokenOut);
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

    ///@notice compare all balances of all tokens not involved in the swap
    function verifyTokenBalances(
        uint256[] memory initBalances,
        IERC20 tokenIn,
        IERC20 tokenOut
    ) internal view returns (uint256[] memory balances) {
        IERC20[] memory tokens = getWhitelistedTokens(); // Get all unique whitelisted tokens
        bool check = initBalances.length != 0;

        if (check) {
            require(
                initBalances.length == tokens.length,
                "balance set length mismatch"
            );
        }

        balances = new uint256[](tokens.length);

        for (uint256 i = 0; i < tokens.length; i++) {
            IERC20 token = tokens[i];
            uint256 balance = token.balanceOf(address(this));

            if (check) {
                // Skip balance comparison for tokenIn and tokenOut
                if (token != tokenIn && token != tokenOut) {
                    require(balance == initBalances[i], "balance mismatch");
                }
            }

            balances[i] = balance;
        }
    }

    function getWhitelistedTokens() internal view returns (IERC20[] memory tokens) {
        uint256 length = uniqueTokens.length();
       tokens = new IERC20[](length);

        for (uint256 i = 0; i < length; i++) {
            tokens[i] = IERC20(uniqueTokens.at(i));
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
