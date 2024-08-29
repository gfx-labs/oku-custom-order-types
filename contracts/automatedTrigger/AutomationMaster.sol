// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "./IAutomation.sol";
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
contract AutomationMaster is
    IAutomation,
    Ownable,
    AutomationCompatibleInterface
{
    using SafeERC20 for IERC20;

    uint88 public MAX_BIPS = 10000;

    uint16 public maxPendingOrders;

    uint256 public minOrderSize; //152

    uint256 public orderCount;

    uint256 public pairCount;

    mapping(IERC20 => IOracleRelay) public oracles;

    mapping(uint256 => Pair) public registeredPairs; //todo offload exchange rate to single oracle contract?

    mapping(uint256 => ORDER) public AllOrders;

    uint256[] public PendingOrderIds;

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

        for (uint i = 0; i < pairCount; i++) {
            pairlist[i] = registeredPairs[i];
        }
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

    ///@notice admin registers a pair for trading
    function registerPair(
        IERC20[] calldata _token0s,
        IERC20[] calldata _token1s
    ) external onlyOwner {
        require(_token0s.length == _token1s.length, "Array Mismatch");

        for (uint i = 0; i < _token0s.length; i++) {
            registeredPairs[pairCount] = Pair({
                token0: _token0s[i],
                token1: _token1s[i]
            });
            pairCount += 1;
        }
    }

    

    ///@notice Direction of swap does not effect exchange rate
    ///@notice Registered Oracles are expected to return the USD price in 1e8 terms
    ///@return exchangeRate should always be 1e8
    function getExchangeRate(
        uint256 pairId
    ) external view returns (uint256 exchangeRate) {
        return _getExchangeRate(pairId, false);
    }

    function _getExchangeRate(
        uint256 pairId,
        bool recip
    ) internal view returns (uint256 exchangeRate) {
        Pair memory pair = registeredPairs[pairId];
        IERC20 token0 = pair.token0;
        IERC20 token1 = pair.token1;

        //control for direction
        if (recip) (token0, token1) = (token1, token0);

        //simple exchange rate in 1e8 terms per oracle output
        exchangeRate = divide(
            oracles[token0].currentValue(),
            oracles[token1].currentValue(),
            8
        );
    }

    ///@notice Calculate price using external oracles,
    ///and apply @param slippageBips to deduce @return minAmountReceived
    ///@return minAmountReceived is scaled to @param tokenOut decimals
    function getMinAmountReceived(
        uint256 pairId,
        bool zeroForOne,
        uint80 slippageBips,
        uint256 amountIn
    ) public view returns (uint256 minAmountReceived) {
        (IERC20 tokenIn, IERC20 tokenOut) = _deducePair(pairId, zeroForOne);
        //er is 0 / 1 => tokenIn / tokenOut
        //if tokenIn != token 0 then recip
        bool recip = tokenIn != registeredPairs[pairId].token0;
        uint256 exchangeRate = _getExchangeRate(pairId, recip);

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
    ///@notice decode pair and direction into @return tokenIn and @return tokenOut
    function deducePair(
        uint256 pairId,
        bool zeroForOne
    ) external view returns (IERC20 tokenIn, IERC20 tokenOut) {
        return _deducePair(pairId, zeroForOne);
    }
    function _deducePair(
        uint256 pairId,
        bool zeroForOne
    ) internal view returns (IERC20 tokenIn, IERC20 tokenOut) {
        Pair memory pair = registeredPairs[pairId];
        if (zeroForOne) {
            tokenIn = pair.token0;
            tokenOut = pair.token1;
        } else {
            tokenIn = pair.token1;
            tokenOut = pair.token0;
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

    function checkUpkeep(
        bytes calldata
    ) external view override returns (bool, bytes memory) {}

    function performUpkeep(bytes calldata) external override {}
}
