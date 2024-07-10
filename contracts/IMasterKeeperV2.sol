// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;
import "./interfaces/chainlink/AutomationCompatibleInterface.sol";
import "./interfaces/uniswapV3/UniswapV3Pool.sol";
import "./interfaces/openzeppelin/ERC20.sol";
import "./oracle/IOracleRelay.sol";

interface IMasterKeeperV2 is AutomationCompatibleInterface {
    

    event OrderCreated(OrderType orderType, uint256 orderId);

    enum OrderType {
        LIMIT,
        STOP_LIMIT,
        STOP_CLOSE,
        STOP_MARKET
    }

    enum Status {
        PENDING,
        FILLED,
        CLAIMED,
        CANCELLED
    }

    //todo pack structs
    struct Order {
        uint256 orderId;
        Status status;
        OrderType orderType;
        bool sell;//initial price > strike price => true (we anticipate price decreasing and selling at that point)
        address owner;
        uint256 strikePrice;
        uint128 batchId;
        IOracleRelay assetInOracle;//only need oracle for asset in, as the usd price of this is the strike price
        StopLimitOrder stopData;
    }

    //todo strikePrice in pending order, StopLimitOrder is only the params to make a limit order

    struct StopLimitOrder {
        UniswapV3Pool pool;
        int24 targetTick;
        uint128 amount;
        bool direction;
        uint256 startingNode; ///This is used as minAmountReceived for market swaps
        uint256 deadline;
    }

    ///@notice top level performUpkeep() decodes this to determine the orderType
    struct PerformData {
        OrderType orderType;
        uint256 orderId;
        bytes data;
    }

    struct OracleInput {
        IOracleRelay oracle0;
        IOracleRelay oracle1;
    }


    function getOracles(UniswapV3Pool pool) external view returns (IOracleRelay[] memory);

}
