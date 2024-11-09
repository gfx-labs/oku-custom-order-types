// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/chainlink/AutomationCompatibleInterface.sol";
import "../interfaces/uniswapV3/IPermit2.sol";
import "../automatedTrigger/IAutomation.sol";
interface ILeverage is IAutomation {
    enum OrderStatus {
        PENDING,
        BLACK,
        RED,
        LIQUIDATED
    }

    /**
     * Liquidate Collateral?
     * Always
     * Only when RED
     * Only when BLACK
     * Never
     */
    enum CollateralOptions {
        ALWAYS,
        BLACK,
        RED,
        NEVER
    }

    struct LeverageUpkeepData {
        uint96 orderId;
        address loanTarget;
        bytes loanTxData;
        address flashTarget;
        bytes flashTxData;
        OrderStatus status;
    }

    struct BracketParams {
        bytes swapPayload;
        uint256 takeProfit;
        uint256 stopPrice;
        uint256 amountIn;
        IERC20 tokenIn;
        IERC20 tokenOut;
        address recipient;
        uint16 feeBips;
        uint16 takeProfitSlippage;
        uint16 stopSlippage;
    }

    struct Order {
        uint96 orderId;
        address recipient;
        CollateralOptions collateralOption;
    }

    /**
     * @notice Deposit collateral, borrow more funds against it, and create a bracket order.
     * @notice `swapPayload` is implied to not be null, as we should swap the borrowed token
     * to the collateral token as the bracket order is created in order to repay with the same token we borrowed.
     * As such, the token taken from the user to act as collateral is bracketParams.tokenIn
     * This is borrowed for swapTokenIn in the swap payload as the borrow token
     * This will be swapped for bracketParams.tokenIn as the bracket order is created
     * Therefore, bracketParams.tokenOut should be the borrow token, so we can repay the loan with the same asset borrowed
     * @notice Token data for the order is deduced from `bracketParams`.
     * @notice Leverage amount is determined by `txData`.
     * @param txData - Data used to borrow funds to increase leverage.
     * @param target - The address to send `txData` to in order to borrow funds.
     */
    function createOrder(
        BracketParams calldata bracketParams,
        bytes calldata txData,
        address target,
        CollateralOptions collateralOption,
        bool permit,
        bytes calldata permitPayload
    ) external;
}
