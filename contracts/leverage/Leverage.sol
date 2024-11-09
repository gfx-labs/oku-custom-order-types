// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "../interfaces/openzeppelin/Ownable.sol";
import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/openzeppelin/SafeERC20.sol";
import "../interfaces/openzeppelin/ReentrancyGuard.sol";

import "../automatedTrigger/Bracket.sol";
import "./ILeverage.sol";

contract Leverage is ILeverage, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    Bracket public immutable BRACKET;
    IPermit2 public immutable permit2;

    uint96[] public pendingOrderIds;

    mapping(uint96 => Order) orders;

    constructor(Bracket _bracket, IPermit2 _permit2) {
        BRACKET = _bracket;
        permit2 = _permit2;
    }

    function getPendingOrders() external view returns (uint96[] memory) {
        return pendingOrderIds;
    }

    ///@notice if bracket order is filled, @return upkeepNeeded true
    ///@notice when the bracket order is filled, resulting funds are sent to the leverage contract
    function checkUpkeep(
        bytes memory
    )
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        for (uint96 i = 0; i < pendingOrderIds.length; i++) {
            Order memory order = orders[pendingOrderIds[i]];
            (bool inRange, uint256 filledAmount) = checkInRange(order);
            if (inRange) {
                return (
                    true,
                    "0x" //todo pack LeverageUpkeepData
                );
            }
        }
    }

    function performUpkeep(bytes memory performData) external override {
        //unpack LeverageUpkeepData
        LeverageUpkeepData memory data = abi.decode(
            performData,
            (LeverageUpkeepData)
        );
        //determine if BLACK, RED, or LIQUIDATED
        //if BLACK && ALWAYS || BLACK => sell collateral
    }
    //borrowTokens tokens: swapTokenIn, tokenOut
    //collateral tokens: tokenIn
    function createOrder(
        BracketParams calldata bracketParams,
        bytes calldata txData,
        address target,
        CollateralOptions collateralOption,
        bool permit,
        bytes calldata permitPayload
    ) external override {
        //question assume swap on order create?
        require(bracketParams.swapPayload.length != 0, "No Swap Payload");

        //unpack swap payload
        SwapParams memory swapParams = abi.decode(
            bracketParams.swapPayload,
            (SwapParams)
        );

        //procure swap token in
        if (permit) {
            handlePermit(
                msg.sender,
                permitPayload,
                uint160(swapParams.swapAmountIn),
                address(swapParams.swapTokenIn)
            );
        } else {
            //take asset, assume prior approval
            swapParams.swapTokenIn.safeTransferFrom(
                msg.sender,
                address(this),
                swapParams.swapAmountIn
            );
        }

        //execute loan tx
        (uint256 borrowAmountOut, uint256 tokenInRefund) = execute(
            target,
            txData,
            bracketParams.amountIn,
            bracketParams.tokenIn,
            swapParams.swapTokenIn
        );

        //create bracket order
        uint96 orderId = BRACKET.createOrder(
            bracketParams.swapPayload,
            bracketParams.takeProfit,
            bracketParams.stopPrice,
            borrowAmountOut,
            bracketParams.tokenIn,
            bracketParams.tokenOut,
            address(this),
            bracketParams.feeBips,
            bracketParams.takeProfitSlippage,
            bracketParams.stopSlippage,
            false,
            "0x"
        );

        //store order
        orders[orderId] = Order({
            orderId: orderId,
            recipient: bracketParams.recipient,
            collateralOption: collateralOption
        });

        //refund any unspent tokenIn
        //this should generally be 0 when using exact input for swaps, which is recommended
        if (tokenInRefund != 0) {
            bracketParams.tokenIn.safeTransfer(
                bracketParams.recipient,
                tokenInRefund
            );
        }
    }

    ///@notice execute borrow transaction
    ///@param target is the contract to which we are sending @param txData to perform the borrow
    ///@param tokenIn is the token to act as collateral
    ///@param tokenOut is what we expect to receive as the borrow token
    function execute(
        address target,
        bytes memory txData,
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut
    ) internal returns (uint256 borrowAmountOut, uint256 tokenInRefund) {
        //update accounting
        uint256 initialTokenIn = tokenIn.balanceOf(address(this));
        uint256 initialTokenOut = tokenOut.balanceOf(address(this));

        //approve
        tokenIn.safeApprove(target, amountIn);

        //perform the call
        (bool success, bytes memory result) = target.call(txData);

        if (success) {
            uint256 finalTokenIn = tokenIn.balanceOf(address(this));
            require(finalTokenIn >= initialTokenIn - amountIn, "over spend");
            uint256 finalTokenOut = tokenOut.balanceOf(address(this));

            borrowAmountOut = finalTokenOut - initialTokenOut;
            tokenInRefund = amountIn - (initialTokenIn - finalTokenIn);

            require(borrowAmountOut != 0, "No Tokens Recieved");
        } else {
            //force revert
            revert TransactionFailed(result);
        }
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

    ///@notice an order is in range if the bracket order with its ID has been filled
    function checkInRange(
        Order memory order
    ) internal view returns (bool inRange, uint256 filledAmount) {
        filledAmount = BRACKET.filledAmount(order.orderId);
        inRange = filledAmount != 0;
        //todo determine if loan is BLACK, RED, LIQUIDATED
    }
}
