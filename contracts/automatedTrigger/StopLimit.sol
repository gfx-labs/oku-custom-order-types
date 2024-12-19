// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IAutomation.sol";
import "../libraries/ArrayMutation.sol";
import "../interfaces/uniswapV3/IPermit2.sol";
import "../interfaces/openzeppelin/Ownable.sol";
import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/openzeppelin/SafeERC20.sol";
import "../interfaces/openzeppelin/ReentrancyGuard.sol";

///@notice This contract owns and handles all logic associated with STOP_LIMIT orders
///STOP_LIMIT orders create a new Bracket order order with the same order ID once filled
contract StopLimit is Ownable, IStopLimit, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IAutomationMaster public immutable MASTER;
    IBracket public immutable BRACKET_CONTRACT;
    IPermit2 public immutable permit2;

    uint96[] public pendingOrderIds;

    mapping(uint96 => Order) public orders;

    constructor(
        IAutomationMaster _master,
        IBracket _bracket,
        IPermit2 _permit2
    ) {
        MASTER = _master;
        BRACKET_CONTRACT = _bracket;
        permit2 = _permit2;
    }

    function getPendingOrders() external view returns (uint96[] memory) {
        return pendingOrderIds;
    }

    ///@notice this should never be called inside of a write function due to high gas usage
    function checkUpkeep(
        bytes calldata checkData
    )
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        uint96 i = 0;
        uint96 length = uint96(pendingOrderIds.length);
        bytes memory checkDataBytes = checkData;
        if (checkDataBytes.length == 64) {
            //decode start and end idxs
            (i, length) = abi.decode(checkData, (uint96, uint96));
            if(length > uint96(pendingOrderIds.length)){
                length = uint96(pendingOrderIds.length);
            }
        }
        for (i; i < length; i++) {
            Order memory order = orders[pendingOrderIds[i]];
            (bool inRange, uint256 exchangeRate) = checkInRange(order);
            if (inRange) {
                return (
                    true,
                    abi.encode(
                        MasterUpkeepData({
                            orderType: OrderType.STOP_LIMIT,
                            target: address(this),
                            txData: order.swapOnFill
                                ? abi.encodePacked(true)
                                : abi.encodePacked(false), //specify if swapOnFill is true
                            pendingOrderIdx: i,
                            orderId: order.orderId,
                            tokenIn: order.tokenIn,
                            tokenOut: order.tokenOut,
                            slippage: order.swapSlippage,
                            amountIn: order.amountIn,
                            exchangeRate: exchangeRate
                        })
                    )
                );
            }
        }
    }

    function performUpkeep(
        bytes calldata performData
    ) external override nonReentrant {
        MasterUpkeepData memory data = abi.decode(
            performData,
            (MasterUpkeepData)
        );
        Order memory order = orders[pendingOrderIds[data.pendingOrderIdx]];

        require(
            order.orderId == pendingOrderIds[data.pendingOrderIdx],
            "Order Fill Mismatch"
        );

        //confirm order is in range to prevent improper fill
        (bool inRange, ) = checkInRange(order);
        require(inRange, "order ! in range");

        //remove from pending array
        pendingOrderIds = ArrayMutation.removeFromArray(
            data.pendingOrderIdx,
            pendingOrderIds
        );

        //approve 0
        order.tokenIn.safeDecreaseAllowance(
            address(BRACKET_CONTRACT),
            (order.tokenIn.allowance(address(this), address(BRACKET_CONTRACT)))
        );

        //approve
        order.tokenIn.safeIncreaseAllowance(
            address(BRACKET_CONTRACT),
            order.amountIn
        );

        bytes memory swapPayload;
        IERC20 tokenIn = order.tokenIn;
        IERC20 tokenOut = order.tokenOut;
        if (order.swapOnFill) {
            //for swap on fill, we expect to be paid out in the same asset we provided
            //so the resulting order tokenIn and tokenOut are inverted relative to our original swap limit order
            SwapParams memory params = SwapParams({
                swapTokenIn: order.tokenIn, //asset provided
                swapAmountIn: order.amountIn,
                swapTarget: data.target,
                swapSlippage: order.swapSlippage,
                txData: data.txData
            });
            swapPayload = abi.encode(params);

            tokenIn = order.tokenOut;
            tokenOut = order.tokenIn;
        }

        //create bracket order
        BRACKET_CONTRACT.fillStopLimitOrder(
            swapPayload,
            order.takeProfit,
            order.stopPrice,
            order.amountIn,
            order.orderId,
            tokenIn,
            tokenOut,
            order.recipient,
            order.feeBips,
            order.takeProfitSlippage,
            order.stopSlippage,
            false, //permit
            "0x" //permitPayload
        );

        //approve 0
        order.tokenIn.safeDecreaseAllowance(
            address(BRACKET_CONTRACT),
            (order.tokenIn.allowance(address(this), address(BRACKET_CONTRACT)))
        );

        emit OrderProcessed(order.orderId);
    }

    ///@notice see @IStopLimit
    function createOrder(
        uint256 stopLimitPrice,
        uint256 takeProfit,
        uint256 stopPrice,
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address recipient,
        uint16 feeBips,
        uint16 takeProfitSlippage,
        uint16 stopSlippage,
        uint16 swapSlippage,
        bool swapOnFill,
        bool permit,
        bytes calldata permitPayload
    ) external override nonReentrant {
        if (permit) {
            handlePermit(
                msg.sender,
                permitPayload,
                uint160(amountIn),
                address(tokenIn)
            );
        } else {
            //take asset, assume prior approval
            tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);
        }

        _createOrder(
            stopLimitPrice,
            takeProfit,
            stopPrice,
            amountIn,
            tokenIn,
            tokenOut,
            recipient,
            feeBips,
            takeProfitSlippage,
            stopSlippage,
            swapSlippage,
            swapOnFill
        );
    }

    ///@notice see @IStopLimit
    function modifyOrder(
        uint96 orderId,
        uint256 _stopLimitPrice,
        uint256 _takeProfit,
        uint256 _stopPrice,
        uint256 _amountInDelta,
        IERC20 _tokenOut,
        address _recipient,
        uint16 _takeProfitSlippage,
        uint16 _stopSlippage,
        uint16 _swapSlippage,
        bool _swapOnFill,
        bool increasePosition,
        uint96 pendingOrderIdx,
        bool permit,
        bytes calldata permitPayload
    ) external override nonReentrant {
        //get existing order
        Order memory order = orders[orderId];
        require(
            order.orderId == pendingOrderIds[pendingOrderIdx],
            "order doesn't exist"
        );
        //only order owner
        require(msg.sender == order.recipient, "only order owner");
        //deduce any amountIn changes
        uint256 newAmountIn = order.amountIn;
        if (_amountInDelta != 0) {
            if (increasePosition) {
                newAmountIn += _amountInDelta;
                //take funds via permit2
                if (permit) {
                    handlePermit(
                        order.recipient,
                        permitPayload,
                        uint160(_amountInDelta),
                        address(order.tokenIn)
                    );
                } else {
                    //legacy transfer, assume prior approval
                    order.tokenIn.safeTransferFrom(
                        order.recipient,
                        address(this),
                        _amountInDelta
                    );
                }
            } else {
                //ensure delta is valid
                require(_amountInDelta < order.amountIn, "invalid delta");

                //set new amountIn for accounting
                newAmountIn -= _amountInDelta;

                //check min order size for new amount
                MASTER.checkMinOrderSize(order.tokenIn, newAmountIn);

                //refund position partially
                order.tokenIn.safeTransfer(order.recipient, _amountInDelta);

                //check slippage
                require(
                    _takeProfitSlippage <= 10000 &&
                        _stopSlippage <= 10000 &&
                        _swapSlippage <= 10000,
                    "BIPS > 10k"
                );
            }
        }

        //check for oracles
        if (_tokenOut != order.tokenOut) {
            require(
                address(MASTER.oracles(_tokenOut)) != address(0x0),
                "Oracle !exist"
            );
        }

        //construct order
        Order memory newOrder = Order({
            orderId: orderId,
            stopLimitPrice: _stopLimitPrice,
            takeProfit: _takeProfit,
            stopPrice: _stopPrice,
            amountIn: newAmountIn,
            tokenIn: order.tokenIn,
            tokenOut: _tokenOut,
            feeBips: order.feeBips,
            takeProfitSlippage: _takeProfitSlippage,
            stopSlippage: _stopSlippage,
            swapSlippage: _swapSlippage,
            recipient: _recipient,
            direction: MASTER.getExchangeRate(order.tokenIn, _tokenOut) >
                _stopLimitPrice,
            swapOnFill: _swapOnFill
        });

        //store new order
        orders[orderId] = newOrder;
    }

    ///@notice contract owner can cancel any order
    ///@notice cancelled orders refund the order recipient
    function adminCancelOrder(uint96 orderId) external onlyOwner nonReentrant{
        _cancelOrder(orderId);
    }

    ///@notice only the order recipient can cancel their order
    ///@notice only pending orders can be cancelled
    function cancelOrder(uint96 orderId) external nonReentrant{
        Order memory order = orders[orderId];
        require(msg.sender == order.recipient, "Only Order Owner");
        require(_cancelOrder(orderId), "Order not active");
    }

    function _createOrder(
        uint256 stopLimitPrice,
        uint256 takeProfit,
        uint256 stopPrice,
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address recipient,
        uint16 feeBips,
        uint16 takeProfitSlippage,
        uint16 stopSlippage,
        uint16 swapSlippage,
        bool swapOnFill
    ) internal {
        //verify both oracles exist, as we need both to calc the exchange rate
        require(
            address(MASTER.oracles(tokenIn)) != address(0x0) &&
                address(MASTER.oracles(tokenOut)) != address(0x0),
            "Oracle !exist"
        );
        require(
            pendingOrderIds.length < MASTER.maxPendingOrders(),
            "Max Order Count Reached"
        );
        require(
            takeProfitSlippage <= 10000 &&
                stopSlippage <= 10000 &&
                swapSlippage <= 10000 &&
                feeBips <= 10000,
            "BIPS > 10k"
        );

        MASTER.checkMinOrderSize(tokenIn, amountIn);

        uint96 orderId = MASTER.generateOrderId(recipient);

        orders[orderId] = Order({
            orderId: orderId,
            stopLimitPrice: stopLimitPrice,
            stopPrice: stopPrice,
            takeProfit: takeProfit,
            amountIn: amountIn,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            takeProfitSlippage: takeProfitSlippage,
            feeBips: feeBips,
            stopSlippage: stopSlippage,
            swapSlippage: swapSlippage,
            recipient: recipient,
            direction: MASTER.getExchangeRate(tokenIn, tokenOut) >
                stopLimitPrice, //compare to stop price for this order's direction
            swapOnFill: swapOnFill
        });
        pendingOrderIds.push(uint96(orderId));
        //emit
        emit OrderCreated(orderId);
    }

    function _cancelOrder(uint96 orderId) internal returns (bool) {
        Order memory order = orders[orderId];
        for (uint96 i = 0; i < pendingOrderIds.length; i++) {
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

    ///@notice handle signature and acquisition of asset with permit2
    function handlePermit(
        address owner,
        bytes calldata permitPayload,
        uint160 amount,
        address token
    ) internal {
        Permit2Payload memory payload = abi.decode(
            permitPayload,
            (Permit2Payload)
        );

        permit2.permit(owner, payload.permitSingle, payload.signature);
        permit2.transferFrom(owner, address(this), amount, token);
    }

    ///@notice check if the order is fillable
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
