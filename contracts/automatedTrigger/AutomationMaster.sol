// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "./IAutomation.sol";
import "../libraries/ArrayMutation.sol";
import "../interfaces/ILimitOrderRegistry.sol";
import "../interfaces/uniswapV3/UniswapV3Pool.sol";
import "../interfaces/uniswapV3/ISwapRouter02.sol";
import "../interfaces/openzeppelin/Ownable.sol";
import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/openzeppelin/SafeERC20.sol";
import "../oracle/IOracleRelay.sol";

///@notice This contract owns and handles all of the settings and accounting logic for automated swaps
///@notice This contract should not hold any user funds, only collected fees 
contract AutomationMaster is IAutomation, Ownable {
    using SafeERC20 for IERC20;

    uint88 public constant MAX_BIPS = 10000;

    uint88 public feeBips;

    uint16 public maxPendingOrders;

    uint256 public minOrderSize;

    IStopLimit public STOP_LIMIT_CONTRACT;
    IBracket public BRACKET_CONTRACT;

    mapping(IERC20 => IOracleRelay) public oracles;

    ///@param _feeBips is the raw bips to determine the fee
    function setFee(uint88 _feeBips) external onlyOwner {
        feeBips = _feeBips;
    }

    function registerSubKeepers(
        IStopLimit stopLimitContract,
        IBracket stopLossLimitContract
    ) external onlyOwner {
        STOP_LIMIT_CONTRACT = stopLimitContract;
        BRACKET_CONTRACT = stopLossLimitContract;
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

    ///@notice set max pending orders, limiting checkUpkeep compute requirement
    function setMaxPendingOrders(uint16 _max) external onlyOwner {
        maxPendingOrders = _max;
    }

    ///@param usdValue must be in 1e8 terms
    function setMinOrderSize(uint256 usdValue) external onlyOwner {
        minOrderSize = usdValue;
    }

    ///@notice sweep the entire balance of @param token to the owner
    ///@notice this contract should not hold funds other than collected fees,
    ///which are forwarded here after each transaction
    function sweep(IERC20 token) external onlyOwner {
        token.safeTransfer(owner(), token.balanceOf(address(this)));
    }

    ///@notice Registered Oracles are expected to return the USD price in 1e8 terms
    ///@return exchangeRate should always be 1e8
    function getExchangeRate(
        IERC20 tokenIn,
        IERC20 tokenOut
    ) external view returns (uint256 exchangeRate) {
        return _getExchangeRate(tokenIn, tokenOut);
    }

    function _getExchangeRate(
        IERC20 tokenIn,
        IERC20 tokenOut
    ) internal view returns (uint256 exchangeRate) {
        // Retrieve USD prices from oracles, scaled to 1e8
        uint256 priceIn = oracles[tokenIn].currentValue();
        uint256 priceOut = oracles[tokenOut].currentValue();

        // Return the exchange rate in 1e8 terms
        return (priceIn * 1e8) / priceOut;
    }

    function getMinAmountReceived(
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint96 slippageBips
    ) external view returns (uint256 minAmountReceived) {
        uint256 exchangeRate = _getExchangeRate(tokenIn, tokenOut);

        // Adjust for decimal differences between tokens
        uint256 adjustedAmountIn = adjustForDecimals(
            amountIn,
            tokenIn,
            tokenOut
        );

        // Calculate the fair amount out without slippage
        uint256 fairAmountOut = (adjustedAmountIn * exchangeRate) / 1e8;

        // Apply slippage (MAX_BIPS is 10000, representing 100%)
        return (fairAmountOut * (MAX_BIPS - slippageBips)) / MAX_BIPS;
    }

    function adjustForDecimals(
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut
    ) internal view returns (uint256 adjustedAmountIn) {
        uint8 decimalIn = ERC20(address(tokenIn)).decimals();
        uint8 decimalOut = ERC20(address(tokenOut)).decimals();

        if (decimalIn > decimalOut) {
            // Reduce amountIn to match the lower decimals of tokenOut
            return amountIn / (10 ** (decimalIn - decimalOut));
        } else if (decimalIn < decimalOut) {
            // Increase amountIn to match the higher decimals of tokenOut
            return amountIn * (10 ** (decimalOut - decimalIn));
        }
        // If decimals are the same, no adjustment needed
        return amountIn;
    }

    ///@notice apply the protocol fee to @param amount
    ///@notice fee is in the form of tokenOut after a successful performUpkeep
    function applyFee(uint256 amount) external view returns (uint256 feeAmount, uint256 adjustedAmount){
        if(feeBips != 0){
            //determine adjusted amount and fee amount
            adjustedAmount = (amount * (MAX_BIPS - feeBips)) / MAX_BIPS;
            feeAmount = amount - adjustedAmount;
        }else{
            return (0, amount);
        }
    }

    function checkMinOrderSize(IERC20 tokenIn, uint256 amountIn) public view {
        uint256 currentPrice = oracles[tokenIn].currentValue();
        uint256 usdValue = (currentPrice * amountIn) /
            (10 ** ERC20(address(tokenIn)).decimals());

        require(usdValue > minOrderSize, "order too small");
    }

    function checkUpkeep(
        bytes calldata
    )
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        //check stop order
        (upkeepNeeded, performData) = STOP_LIMIT_CONTRACT.checkUpkeep("0x");
        if (upkeepNeeded) {
            return (true, performData);
        }

        //check stop loss limit order
        (upkeepNeeded, performData) = BRACKET_CONTRACT.checkUpkeep(
            "0x"
        );
        if (upkeepNeeded) {
            return (true, performData);
        }
    }

    function performUpkeep(bytes calldata performData) external override {
        //decode into masterUpkeepData
        MasterUpkeepData memory data = abi.decode(
            performData,
            (MasterUpkeepData)
        );

        //if stop order, we directly pass the upkeep data to the stop order contract
        if (data.orderType == OrderType.STOP_LIMIT) {
            STOP_LIMIT_CONTRACT.performUpkeep(performData);
        }

        //if stop order, we directly pass the upkeep data to the stop order contract
        if (data.orderType == OrderType.BRACKET) {
            BRACKET_CONTRACT.performUpkeep(performData);
        }
    }
}
