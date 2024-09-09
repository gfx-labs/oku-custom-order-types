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

///testing
import "hardhat/console.sol";

///@notice This contract owns and handles all logic asstopLimitContractiated with STOP_MARKET orders
///@notice STOP_MARKET orders check an external oracle for a pre-determined strike price,
///once this price is reached, a market swap occurs
contract AutomationMaster is IAutomation, Ownable {
    using SafeERC20 for IERC20;

    uint88 public constant MAX_BIPS = 10000;

    uint16 public maxPendingOrders;

    uint256 public minOrderSize;

    ILimitOrder public LIMIT_ORDER_CONTRACT;
    IStopLimit public STOP_LIMIT_CONTRACT;
    IStopLossLimit public STOP_LOSS_LIMIT_CONTRACT;

    mapping(IERC20 => IOracleRelay) public oracles;

    function registerSubKeepers(
        ILimitOrder limitOrderContract,
        IStopLimit stopLimitContract,
        IStopLossLimit stopLossLimitContract
    ) external onlyOwner {
        LIMIT_ORDER_CONTRACT = limitOrderContract;
        STOP_LIMIT_CONTRACT = stopLimitContract;
        STOP_LOSS_LIMIT_CONTRACT = stopLossLimitContract;
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
        uint256 amountIn,
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint88 slippageBips
    ) external view returns (uint256 minAmountReceived) {
        //er is 0 / 1 => tokenIn / tokenOut
        //if tokenIn != token 0 then recip
        uint256 exchangeRate = _getExchangeRate(tokenIn, tokenOut);

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

    function checkMinOrderSize(IERC20 tokenIn, uint256 amountIn) public view {
        uint256 currentPrice = oracles[tokenIn].currentValue();
        uint256 usdValue = (currentPrice * amountIn) /
            (10 ** ERC20(address(tokenIn)).decimals());

        require(usdValue > minOrderSize, "order too small");
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

    function checkUpkeep(
        bytes calldata
    )
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        //todo checkUpkeep on sub keepers

        //check limit order
        (upkeepNeeded, performData) = LIMIT_ORDER_CONTRACT.checkUpkeep("0x");
        if (upkeepNeeded) {
            return (true, performData);
        }

        //check stop order
        (upkeepNeeded, performData) = STOP_LIMIT_CONTRACT.checkUpkeep("0x");
        if (upkeepNeeded) {
            return (true, performData);
        }

        //check stop loss limit order
        (upkeepNeeded, performData) = STOP_LOSS_LIMIT_CONTRACT.checkUpkeep("0x");
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

        //if limit order, we need externally derived txData and target
        if (data.orderType == OrderType.LIMIT) {
            //do limit
            LIMIT_ORDER_CONTRACT.performUpkeep(performData);
        }

        //if stop order, we directly pass the upkeep data to the stop order contract
        if (data.orderType == OrderType.STOP_LIMIT) {
            STOP_LIMIT_CONTRACT.performUpkeep(performData);
        }

        //if stop order, we directly pass the upkeep data to the stop order contract
        if (data.orderType == OrderType.STOP_LOSS_LIMIT) {
            STOP_LOSS_LIMIT_CONTRACT.performUpkeep(performData);
        }
    }
}
