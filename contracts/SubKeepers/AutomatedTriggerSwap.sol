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

///testing
import "hardhat/console.sol";

///@notice This contract owns and handles all logic associated with STOP_MARKET orders
///@notice STOP_MARKET orders check an external oracle for a pre-determined strike price,
///once this price is reached, a market swap occurs
contract AutomatedTriggerSwap is Ownable, AutomationCompatibleInterface {
    using SafeERC20 for IERC20;

    uint88 public MAX_BIPS = 10000;

    uint16 public maxPendingOrders;

    uint256 public minOrderSize; //152

    uint256 public orderCount;
    uint256 public pairCount;

    uint256[] public PendingOrderIds;

    mapping(uint256 => Order) public AllOrders;
    mapping(IERC20 => IOracleRelay) public oracles;

    mapping(uint256 => Pair) public registeredPairs; //todo offload exchange rate to single oracle contract?

    struct Pair {
        IERC20 token0;
        IERC20 token1;
    }

    struct Order {
        uint256 orderId;
        uint256 strikePrice; //defined by exchange rate of tokenIn / tokenOut
        uint256 amountIn;
        uint256 pairId;
        address recipient; //addr to receive swap results
        uint80 slippageBips;
        bool zeroForOne;
        bool direction; //true if initial exchange rate > strike price
    }

    struct UpkeepData {
        uint256 pendingOrderIdx;
        Order order;
    }

    event OrderCreated(uint256 orderId);
    event OrderProcessed(uint256 orderId, bool success, bytes result);
    event OrderCancelled(uint256 orderId);

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

    ///@notice set max pending orders, limiting checkUpkeep compute requirement
    function setMaxPendingOrders(uint16 _max) external onlyOwner {
        maxPendingOrders = _max;
    }

    ///@param usdValue must be in 1e8 terms
    function setMinOrderSize(uint256 usdValue) external onlyOwner {
        minOrderSize = usdValue;
    }

    ///@notice admin registers a pair for trading
    function registerPair(IERC20 _token0, IERC20 _token1) external onlyOwner {
        pairCount += 1;
        registeredPairs[pairCount] = Pair({token0: _token0, token1: _token1});
    }

    function getPendingOrders()
        external
        view
        returns (uint256[] memory pendingOrderIds)
    {
        return PendingOrderIds;
    }

    ///@notice get all registered pairs as an array @param pairlist
    function getPairList() external view returns (Pair[] memory pairlist) {
        pairlist = new Pair[](pairCount);

        for (uint i = 1; i <= pairCount; i++) {
            pairlist[i] = registeredPairs[i];
        }
    }

    ///@param strikePrice is in terms of exchange rate of tokenIn / tokenOut
    function createOrder(
        uint256 strikePrice,
        uint256 amountIn,
        uint256 pairId,
        uint80 slippageBips,
        bool zeroForOne
    ) external {
        (IERC20 tokenIn, IERC20 tokenOut) = deducePair(pairId, zeroForOne);
        //verify both oracles exist, as we need both to calc the exchange rate
        require(
            address(oracles[tokenIn]) != address(0x0),
            "tokenIn Oracle !exist"
        );
        require(
            address(oracles[tokenOut]) != address(0x0),
            "tokenOut Oracle !exist"
        );

        require(orderCount < maxPendingOrders, "Max Order Count Reached");

        require(slippageBips <= MAX_BIPS, "Invalid Slippage BIPS");

        //verify order amount is at least the minimum
        checkMinOrderSize(tokenIn, amountIn);

        orderCount++;
        AllOrders[orderCount] = Order({
            orderId: orderCount,
            strikePrice: strikePrice,
            amountIn: amountIn,
            slippageBips: slippageBips,
            pairId: pairId,
            recipient: msg.sender,
            zeroForOne: zeroForOne,
            direction: _getExchangeRate(tokenIn, tokenOut, true) > strikePrice //exchangeRate in/out > strikePrice
        });
        PendingOrderIds.push(orderCount);

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

    function adminCancelOrder(uint256 orderId) external onlyOwner {
        _cancelOrder(orderId);
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
                (IERC20 tokenIn, ) = deducePair(order.pairId, order.zeroForOne);
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
            Order memory order = AllOrders[PendingOrderIds[i]];
            (IERC20 tokenIn, IERC20 tokenOut) = deducePair(
                order.pairId,
                order.zeroForOne
            );
            uint256 exchangeRate = _getExchangeRate(tokenIn, tokenOut, true);
            if (order.direction) {
                if (exchangeRate <= order.strikePrice) {
                    return (
                        true,
                        abi.encode(
                            UpkeepData({pendingOrderIdx: i, order: order})
                        )
                    );
                }
            } else {
                if (exchangeRate >= order.strikePrice) {
                    return (
                        true,
                        abi.encode(
                            UpkeepData({pendingOrderIdx: i, order: order})
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
        Order memory order = AllOrders[PendingOrderIds[pendingOrderIdx]];
        (IERC20 tokenIn, IERC20 tokenOut) = deducePair(
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
                    getMinAmountReceived(
                        tokenIn,
                        tokenOut,
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

    ///@notice Direction of swap does not effect exchange rate
    ///@notice Registered Oracles are expected to return the USD price in 1e8 terms
    ///@return exchangeRate should always be 1e8
    function getExchangeRate(
        IERC20 tokenIn,
        IERC20 tokenOut
    ) external view returns (uint256 exchangeRate) {
        return _getExchangeRate(tokenIn, tokenOut, true);
    }

    function _getExchangeRate(
        IERC20 tokenIn,
        IERC20 tokenOut,
        bool fixedDirection
    ) internal view returns (uint256 exchangeRate) {
        //control for direction
        if (fixedDirection && (address(tokenIn) > address(tokenOut)))
            (tokenIn, tokenOut) = (tokenOut, tokenIn);

        //simple exchange rate in 1e8 terms per oracle output
        exchangeRate = divide(
            oracles[tokenIn].currentValue(),
            oracles[tokenOut].currentValue(),
            8
        );
    }

    ///@notice Calculate price using external oracles,
    ///and apply @param slippageBips to deduce @return minAmountReceived
    ///@return minAmountReceived is scaled to @param tokenOut decimals
    function getMinAmountReceived(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint88 slippageBips,
        uint256 amountIn
    ) public view returns (uint256 minAmountReceived) {
        uint256 exchangeRate = _getExchangeRate(tokenIn, tokenOut, false);

        //this assumes decimalIn == decimalOut
        uint256 fairAmountOut = ((amountIn) * exchangeRate) / 1e8;

        uint8 decimalIn = ERC20(address(tokenIn)).decimals();
        uint8 decimalOut = ERC20(address(tokenOut)).decimals();

        if (decimalIn > decimalOut) {
            uint256 factor = (10 ** (decimalIn - decimalOut));
            fairAmountOut = (fairAmountOut / factor);
        }

        if (decimalIn < decimalOut) {
            uint256 factor = (10 ** (decimalOut - decimalIn));
            fairAmountOut = (fairAmountOut * factor);
        }

        //scale by slippage
        return (fairAmountOut * (MAX_BIPS - slippageBips)) / MAX_BIPS;
    }

    function checkMinOrderSize(IERC20 tokenIn, uint256 amountIn) internal view {
        uint256 currentPrice = oracles[tokenIn].currentValue();
        uint256 usdValue = (currentPrice * amountIn) /
            (10 ** ERC20(address(tokenIn)).decimals());

        require(usdValue > minOrderSize, "order too small");
    }

    ///@notice this should only be called during checkUpkeep() due to its heavy gas usage
    function deducePair(
        uint256 pairId,
        bool zeroForOne
    ) internal view returns (IERC20 tokenIn, IERC20 tokenOut) {
        Pair memory pair = registeredPairs[pairId];
        if (zeroForOne) {
            tokenIn = pair.token0;
            tokenOut = pair.token1;
        } else {
            tokenIn = pair.token1;
            tokenOut = pair.token1;
        }
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
