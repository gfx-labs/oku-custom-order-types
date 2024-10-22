// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/chainlink/AutomationCompatibleInterface.sol";

interface IAutomation is AutomationCompatibleInterface {
    error TransactionFailed(bytes reason);

    enum OrderType {
        STOP_LIMIT,
        STOP_LOSS_LIMIT
    }

    struct Permit2Payload {
        IPermit2.PermitSingle permitSingle;
        bytes signature;
    }

    ///@notice params for swap on limit order create
    ///@param swapTokenIn may or may not be the same as @param tokenOut
    struct SwapParams {
        IERC20 swapTokenIn;
        uint256 swapAmountIn;
        address swapTarget;
        uint32 swapBips;
        bytes txData;
    }

    struct MasterUpkeepData {
        OrderType orderType;
        address target;
        IERC20 tokenIn;
        IERC20 tokenOut;
        uint96 orderId;
        uint16 pendingOrderIdx;
        uint88 bips;
        uint256 amountIn;
        uint256 exchangeRate;
        bytes txData;
    }

    event OrderProcessed(uint256 orderId, bool success, bytes result);
    event OrderCreated(uint256 orderId);
    event OrderCancelled(uint256 orderId);
}

interface IStopLimit is IAutomation {
    event StopLimitOrderProcessed(uint256 orderId);

    ///@param direction determines the expected direction of price movement
    ///if true, strike price is above the current exchange rate and strike price is expected to be below
    ///vice versa if false
    struct Order {
        uint256 stopLimitPrice;
        uint256 strikePrice;
        uint256 stopPrice;
        uint256 amountIn;
        uint96 orderId;
        IERC20 tokenIn;
        IERC20 tokenOut;
        address recipient;
        uint16 strikeSlippage;
        uint16 stopSlippage;
        uint16 swapSlippage;
        bool direction;
        bool swapOnFill;
    }

    ///@notice if no stop loss is desired, set to 0
    ///@param tokenIn asset to provide
    ///@param tokenOut asset to receive after resulting limit order is filled
    ///@param stopLimitPrice execution price for stop limit order
    ///@param strikePrice execution 'take profit' price for resulting limit order
    ///@param stopPrice execution 'stop loss' price for resulting limit order
    ///@param swapSlippage slippage for optional swap, only used if @param swapOnFill is true
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
    ) external;
}

interface IBracket is IAutomation {
    struct Order {
        uint256 strikePrice; //defined by exchange rate of tokenIn / tokenOut
        uint256 stopPrice;
        uint256 amountIn;
        uint96 orderId;
        IERC20 tokenIn;
        IERC20 tokenOut;
        address recipient; //addr to receive swap results
        uint32 strikeSlippage; //slippage if order is filled
        uint32 stopSlippage; //slippage of stop price is reached
        bool direction; //true if initial exchange rate > strike price
    }

    function createOrder(
        bytes calldata swapPayload,
        uint256 strikePrice,
        uint256 stopPrice,
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut,
        address recipient,
        uint32 strikeSlippage,
        uint32 stopSlippage,
        bool permit,
        bytes calldata permitPayload
    ) external;
}

interface IPermit2 {
    /// @notice The token and amount details for a transfer signed in the permit transfer signature
    struct TokenPermissions {
        // ERC20 token address
        address token;
        // the maximum amount that can be spent
        uint256 amount;
    }

    /// @notice The signed permit message for a single token transfer
    struct PermitTransferFrom {
        TokenPermissions permitted;
        // a unique value for every token owner's signature to prevent signature replays
        uint256 nonce;
        // deadline on the permit signature
        uint256 deadline;
    }

    /// @notice Specifies the recipient address and amount for batched transfers.
    /// @dev Recipients and amounts correspond to the index of the signed token permissions array.
    /// @dev Reverts if the requested amount is greater than the permitted signed amount.
    struct SignatureTransferDetails {
        // recipient address
        address to;
        // spender requested amount
        uint256 requestedAmount;
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32);

    /// @notice A mapping from owner address to token address to spender address to PackedAllowance struct, which contains details and conditions of the approval.
    /// @notice The mapping is indexed in the above order see: allowance[ownerAddress][tokenAddress][spenderAddress]
    /// @dev The packed slot holds the allowed amount, expiration at which the allowed amount is no longer valid, and current nonce thats updated on any signature based approvals.
    function allowance(
        address,
        address,
        address
    ) external view returns (uint160, uint48, uint48);

    function transferFrom(
        address from,
        address to,
        uint160 amount,
        address token
    ) external;

    /// @notice Transfers a token using a signed permit message
    /// @dev Reverts if the requested amount is greater than the permitted signed amount
    /// @param permit The permit data signed over by the owner
    /// @param owner The owner of the tokens to transfer
    /// @param transferDetails The spender's requested transfer details for the permitted token
    /// @param signature The signature to verify
    function permitTransferFrom(
        PermitTransferFrom memory permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;

    /// @notice The permit data for a token
    struct PermitDetails {
        // ERC20 token address
        address token;
        // the maximum amount allowed to spend
        uint160 amount;
        // timestamp at which a spender's token allowances become invalid
        uint48 expiration;
        // an incrementing value indexed per owner,token,and spender for each signature
        uint48 nonce;
    }

    /// @notice The permit message signed for a single token allownce
    struct PermitSingle {
        // the permit data for a single token alownce
        PermitDetails details;
        // address permissioned on the allowed tokens
        address spender;
        // deadline on the permit signature
        uint256 sigDeadline;
    }

    /// @notice Permit a spender to a given amount of the owners token via the owner's EIP-712 signature
    /// @dev May fail if the owner's nonce was invalidated in-flight by invalidateNonce
    /// @param owner The owner of the tokens being approved
    /// @param permitSingle Data signed over by the owner specifying the terms of approval
    /// @param signature The owner's signature over the permit data
    function permit(
        address owner,
        PermitSingle memory permitSingle,
        bytes calldata signature
    ) external;
}
