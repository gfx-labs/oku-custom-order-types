// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "../IMasterKeeperV2.sol";
import "../interfaces/chainlink/AutomationCompatibleInterface.sol";
import "../libraries/ArrayMutation.sol";

import "../interfaces/ILimitOrderRegistry.sol";
import "../interfaces/uniswapV3/UniswapV3Pool.sol";
import "../interfaces/uniswapV3/ISwapRouter02.sol";
import "../interfaces/openzeppelin/Ownable.sol";
import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/openzeppelin/SafeERC20.sol";

import "../oracle/IOracleRelay.sol";

//import "../interfaces/chainlink/AutomationCompatibleInterface.sol";

///testing
import "hardhat/console.sol";

///@notice This contract owns and handles all logic associated with STOP_MARKET orders
///@notice STOP_MARKET orders check an external oracle for a pre-determined strike price,
///once this price is reached, a market swap occurs
contract AutomatedTriggerSwap is Ownable, AutomationCompatibleInterface {
    using SafeERC20 for IERC20;

    uint88 MAX_BIPS = 10000;

    IMasterKeeperV2 public immutable MASTER;

    mapping(IERC20 => IOracleRelay) public oracles;

    struct Order {
        uint256 orderId;
        uint256 strikePrice; //defined by exchange rate of tokenIn / tokenOut
        uint256 amountIn;
        IERC20 tokenIn;
        IERC20 tokenOut;
        address recipient; //addr to receive swap results
        uint88 slippageBips;
        bool direction; //true if initial exchange rate > strike price
    }

    struct PerformData {
        uint256 pendingOrderIdx;
        Order order;
    }

    event OrderCreated(uint256 orderId);
    event OrderProcessed(uint256 orderId, bool success, bytes result);
    event OrderCancelled(uint256 orderId);

    ///@notice idx for all orders
    uint256 public orderCount;
    mapping(uint256 => Order) public AllOrders;
    uint256[] public PendingOrderIds;

    constructor(IMasterKeeperV2 _mkv2) {
        MASTER = _mkv2;
    }

    ///@notice Registered Oracles are expected to return the USD price in 1e8 terms
    function registerOracle(
        IERC20[] calldata _tokens,
        IOracleRelay[] calldata _oracles
    ) external onlyOwner {
        require(_tokens.length == _oracles.length, "Array Length Mismatch");
        for (uint i = 0; i < _tokens.length; i++) {
            oracles[_tokens[i]] = _oracles[i];
        }
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
        uint88 slippageBips,
        IERC20 tokenIn,
        IERC20 tokenOut
    ) external {
        //verify both oracles exist, as we need both to calc the exchange rate
        require(
            address(oracles[tokenIn]) != address(0x0),
            "Token In Oracle !exist"
        );
        require(
            address(oracles[tokenOut]) != address(0x0),
            "Token Out Oracle !exist"
        );

        require(slippageBips <= MAX_BIPS, "INVALID BIPS");

        orderCount++;
        AllOrders[orderCount] = Order({
            orderId: orderCount,
            strikePrice: strikePrice,
            amountIn: amountIn,
            slippageBips: slippageBips,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            recipient: msg.sender,
            direction: getExchangeRate(tokenIn, tokenOut) > strikePrice //exchangeRate in/out > strikePrice
        });
        PendingOrderIds.push(orderCount);

        //console.log("Order: ", orderCount, "Direction: ", getExchangeRate(tokenIn, tokenOut) > strikePrice);

        //take asset
        tokenIn.safeTransferFrom(msg.sender, address(this), amountIn);

        //emit
        emit OrderCreated(orderCount);
    }

    ///@notice only the order recipient can cancel their order
    ///@notice only pending orders can be cancelled
    function cancelOrder(uint256 orderId) external {
        Order memory order = AllOrders[orderId];
        require(msg.sender == order.recipient, "Only Order Owner");
        require(_cancelOrder(orderId), "Order not active");
    }

    function _cancelOrder(uint256 orderId) internal returns (bool) {
        Order memory order = AllOrders[orderId];
        for (uint i = 0; i < PendingOrderIds.length; i++) {
            if (PendingOrderIds[i] == orderId) {
                //remove from pending array
                PendingOrderIds = ArrayMutation.removeFromArray(
                    i,
                    PendingOrderIds
                );

                //refund tokens
                order.tokenIn.safeTransfer(order.recipient, order.amountIn);

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
            Order memory _order = AllOrders[PendingOrderIds[i]];
            uint256 exchangeRate = getExchangeRate(
                _order.tokenIn,
                _order.tokenOut
            );
            if (_order.direction) {
                if (exchangeRate <= _order.strikePrice) {
                    return (
                        true,
                        abi.encode(
                            PerformData({pendingOrderIdx: i, order: _order})
                        )
                    );
                }
            } else {
                if (exchangeRate >= _order.strikePrice) {
                    return (
                        true,
                        abi.encode(
                            PerformData({pendingOrderIdx: i, order: _order})
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
        (address target, PerformData memory data) = abi.decode(
            performData,
            (address, PerformData)
        );

        //update accounting
        uint256 initialTokenOut = data.order.tokenOut.balanceOf(address(this));

        //approve
        updateApproval(target, data.order.tokenIn, data.order.amountIn);

        //perform the call
        (bool success, bytes memory result) = target.call(performData);

        if (success) {
            uint256 finalTokenOut = data.order.tokenOut.balanceOf(
                address(this)
            );

            //if success, we expect tokenIn balance to decrease by amountIn
            //and tokenOut balance to increase by at least minAmountReceived
            require(
                finalTokenOut - initialTokenOut >
                    getMinAmountReceived(
                        data.order.tokenIn,
                        data.order.tokenOut,
                        data.order.slippageBips,
                        data.order.amountIn
                    ),
                "Too Little Received"
            );

            //remove from pending array
            PendingOrderIds = ArrayMutation.removeFromArray(
                data.pendingOrderIdx,
                PendingOrderIds
            );

            //send tokenOut to recipient
            data.order.tokenOut.safeTransfer(
                data.order.recipient,
                finalTokenOut - initialTokenOut
            );
        }

        //emit
        emit OrderProcessed(data.order.orderId, success, result);
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

    ///todo test a lot more for decimals, USDC/WBTC
    ///@notice Direction of swap does not effect exchange rate
    ///@notice Registered Oracles are expected to return the USD price in 1e8 terms
    ///@return exchangeRate should always be 1e8
    function getExchangeRate(
        IERC20 tokenIn,
        IERC20 tokenOut
    ) public view returns (uint256 exchangeRate) {
        //control for direction
        if (address(tokenIn) > address(tokenOut))
            (tokenIn, tokenOut) = (tokenOut, tokenIn);

        //simple exchange rate in 1e8 terms per oracle output
        exchangeRate = divide(
            oracles[tokenIn].currentValue(),
            oracles[tokenOut].currentValue(),
            8
        );
    }

    //todo incorporate direction after exchange rate change
    ///@notice apply slippage
    ///@return minAmountReceived should return already scaled to @param tokenOut decimals
    function getMinAmountReceived(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint88 slippageBips,
        uint256 amountIn
    ) public view returns (uint256 minAmountReceived) {
        //adjust exchange rate by tokenOut Decimals
        uint256 adjustedExchangeRate = getExchangeRate(tokenIn, tokenOut) /
            (1e8 / (10 ** ERC20(address(tokenOut)).decimals()));

        //minAmountReceived is then adjusted by tokenIn decimals
        minAmountReceived =
            (((adjustedExchangeRate * amountIn) /
                (10 ** ERC20(address(tokenIn)).decimals())) *
                ((MAX_BIPS - slippageBips))) /
            MAX_BIPS;
    }

    ///@notice floating point division at @param factor scale
    function divide(
        uint256 numerator,
        uint256 denominator,
        uint256 factor
    ) internal pure returns (uint256 result) {
        uint256 q = (numerator / denominator) * 10 ** factor;
        uint256 r = ((numerator * 10 ** factor) / denominator) % 10 ** factor;

        return q + r;
    }
}
