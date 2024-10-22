// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "./IAutomation.sol";
import "./AutomationMaster.sol";
import "../libraries/ArrayMutation.sol";
import "../interfaces/ILimitOrderRegistry.sol";
import "../interfaces/uniswapV3/UniswapV3Pool.sol";
import "../interfaces/uniswapV3/ISwapRouter02.sol";
import "../interfaces/openzeppelin/Ownable.sol";
import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/openzeppelin/SafeERC20.sol";
import "../interfaces/openzeppelin/ReentrancyGuard.sol";
import "../oracle/IOracleRelay.sol";


///@notice This contract owns and handles all logic associated with STOP_LIMIT orders
///STOP_LIMIT orders create a new limit order order once filled
contract StopLimit is Ownable, IStopLimit, ReentrancyGuard {
    using SafeERC20 for IERC20;

    AutomationMaster public immutable MASTER;
    IBracket public immutable BRACKET_CONTRACT;
    IPermit2 public immutable permit2;

    uint96 public orderCount;

    uint16[] public pendingOrderIds;

    mapping(uint256 => Order) public orders;

    constructor(
        AutomationMaster _master,
        IBracket _bracket,
        IPermit2 _permit2
    ) {
        MASTER = _master;
        BRACKET_CONTRACT = _bracket;
        permit2 = _permit2;
    }

    function getPendingOrders() external view returns (uint16[] memory) {
        return pendingOrderIds;
    }
    //todo non reentrant
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
        uint16 strikeSlipapge,
        uint16 stopSlippage,
        uint16 swapSlippage,
        bool swapOnFill,
        bool permit,
        bytes calldata permitPayload
    ) external override nonReentrant {
        if (permit) {
            handlePermit(
                recipient,
                permitPayload,
                uint160(amountIn),
                address(tokenIn)
            );
        } else {
            //take asset, assume prior approval
            tokenIn.safeTransferFrom(recipient, address(this), amountIn);
        }

        _createOrder(
            stopLimitPrice,
            strikePrice,
            stopPrice,
            amountIn,
            tokenIn,
            tokenOut,
            recipient,
            strikeSlipapge,
            stopSlippage,
            swapSlippage,
            swapOnFill
        );
    }

    function _createOrder(
        uint256 stopLimitPrice,
        uint256 strikePrice,
        uint256 stopPrice,
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address recipient,
        uint16 strikeSlipapge,
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
        pendingOrderIds.push(uint16(orderCount));
        //emit
        emit OrderCreated(orderCount);
    }
    //todo modify token out?
    ///@notice this can use permit or approve if increasing the position size
    ///@param increasePosition is true if adding to the position, false if reducing the position
    ///@param permit is true if @param _amountInDelta > 0 and permit is used for approval
    ///@param permit can be set to false if using legacy approval, in which case @param permitPayload may be set to 0x
    function modifyOrder(
        uint96 orderId,
        uint256 _stopLimitPrice,
        uint256 _strikePrice,
        uint256 _stopPrice,
        uint256 _amountInDelta,
        IERC20 _tokenOut,
        address _recipient,
        uint16 _strikeSlippage,
        uint16 _stopSlippage,
        uint16 _swapSlippage,
        bool _swapOnFill,
        bool permit,
        bool increasePosition,
        bytes calldata permitPayload
    ) external nonReentrant {
        //get existing order
        Order memory order = orders[orderId];
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
            }
        }

        //check for oracles
        if (_tokenOut != order.tokenOut) {
            require(
                address(MASTER.oracles(_tokenOut)) != address(0x0),
                "Oracle !exist"
            );
        }

        Order memory newOrder = Order({
            orderId: orderId,
            stopLimitPrice: _stopLimitPrice,
            strikePrice: _strikePrice,
            stopPrice: _stopPrice,
            amountIn: newAmountIn,
            tokenIn: order.tokenIn,
            tokenOut: _tokenOut,
            strikeSlippage: _strikeSlippage,
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
        for (uint16 i = 0; i < pendingOrderIds.length; i++) {
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
        for (uint16 i = 0; i < pendingOrderIds.length; i++) {
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
    function performUpkeep(
        bytes calldata performData
    ) external override nonReentrant {
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
        updateApproval(
            address(BRACKET_CONTRACT),
            order.tokenIn,
            order.amountIn
        );

        //TODO refactor this for new createOrder
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
                swapBips: order.swapSlippage,
                txData: data.txData
            });
            swapPayload = abi.encode(params);

            //invert tokens as we are about to swap
            tokenIn = order.tokenOut;
            tokenOut = order.tokenIn;
        }

        //create standard order without swap on fill
        BRACKET_CONTRACT.createOrder(
            swapPayload,
            order.strikePrice,
            order.stopPrice,
            order.amountIn,
            tokenIn,
            tokenOut,
            order.recipient,
            order.strikeSlippage,
            order.stopSlippage,
            false, //permit
            "0x" //permitPayload
        );

        emit StopLimitOrderProcessed(order.orderId);
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
