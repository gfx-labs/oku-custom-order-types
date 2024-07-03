// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "./interfaces/chainlink/AutomationCompatibleInterface.sol";
import "./interfaces/openzeppelin/Ownable.sol";
import "./interfaces/openzeppelin/ERC20.sol";
import "./interfaces/openzeppelin/SafeTransferLib.sol";
import "./interfaces/uniswapV3/UniswapV3Pool.sol";
import "./libraries/ArrayMutation.sol";

import "./interfaces/ILimitOrderRegistry.sol";

///@notice V2 - Includes logic for stop and stop-limit orders
///@notice Only stop and stop-limit orders can be pending, and pending orders are tracked by this contract until the strike price is reached
///@notice This contract serves as a single keeper to handle upkeep for all pools in the LimitOrderRegistry
///@notice New pools will need to be added here for this upkeep to track them
contract MasterKeeperV2 is Ownable, AutomationCompatibleInterface {
    using SafeTransferLib for ERC20;

    ILimitOrderRegistry public LimitOrderRegistry;

    ///@notice list of registered pools to watch for standard limit orders via Limit Order Registry
    UniswapV3Pool[] public list;

    ///@notice idx for pending orders
    uint256 public orderCount;

    mapping(uint256 => PendingOrder) public orders;

    enum OrderType {
        LIMIT,
        STOP_LIMIT,
        STOP_CLOSE,
        STOP_MARKET
    }

    struct PendingOrder {
        bool filled;
        OrderType orderType;
        address owner;
        uint256 orderId;
        StopLimitOrder stopData;
    }

    struct pData {
        OrderType orderType;
        bytes data;
    }

    struct StopLimitOrder {
        UniswapV3Pool pool;
        int24 targetTick;
        uint128 amount;
        bool direction;
        uint256 startingNode;///This is used as minAmountReceived for market swaps
        uint256 deadline;
        int24 strikeTick;
    }

    constructor(ILimitOrderRegistry _LimitOrderRegistry) {
        LimitOrderRegistry = _LimitOrderRegistry;
    }

    ///@notice get the current list of tracked pools
    function getList()
        external
        view
        returns (UniswapV3Pool[] memory currentList)
    {
        currentList = list;
    }

    ///@notice add new @param pools to the list
    function addPools(UniswapV3Pool[] memory pools) external onlyOwner {
        for (uint i = 0; i < pools.length; i++) {
            list.push(pools[i]);
        }
    }

    ///@notice remove all pools from the list
    function clearPools() external onlyOwner {
        list = new UniswapV3Pool[](0);
    }

    ///@notice Remove pool by index: @param idx
    ///@notice use function getList() and choose index based on the array returned
    function removePool(uint256 idx) external onlyOwner {
        list = ArrayMutation.removeFromArray(idx, list);
    }

    function createMarketStopOrder(
        UniswapV3Pool pool,
        int24 strikeTick,
        address tokenIn,
        uint256 amount,
        uint256 minAmountReceived
    ) external {
        //todo
        //take funds from user, accounting for amounts
        //store the pending stop order
    }

    ///@notice limit order to be closed if the @param strikeTick is reached
    ///@param tokenId == 0 indicates if we will be creating a new order, rather than apply to existing order
    function createStopOrder(uint256 tokenId, int24 strikeTick) external {
        //todo
        //determine if we own the position if applying to existing position
        //if new order, create the order, and store the things
    }

    ///@notice this type of order will simply execute a market swap at the stop price
    function createStopMarketOrder(
        UniswapV3Pool pool,
        uint128 amount,
        bool direction,
        uint256 minAmountReceived,
        uint256 deadline,
        int24 strikeTick
    ) external {
        //todo
        //market swap at strike tick
        ERC20 assetIn = deduceAsset(pool, direction);
        //store pending order
        orderCount = orderCount + 1;
        orders[orderCount] = PendingOrder({
            filled: false,
            orderType: OrderType.STOP_MARKET,
            owner: msg.sender,
            orderId: orderCount,
            stopData: StopLimitOrder({
                pool: pool,
                targetTick: strikeTick,
                amount: amount,
                direction: direction,
                startingNode: minAmountReceived,
                deadline: deadline,
                strikeTick: strikeTick
            })
        });
    }

    ///@notice we omit the minimum liquidity checks, Limit Order Registry will perform those when the strike price is reached
    ///@notice as such, if minimum liquidity is not met, execution will fail and funds will be returned at that time todo
    function createStopLimitOrder(
        UniswapV3Pool pool,
        int24 targetTick,
        uint128 amount,
        bool direction,
        uint256 startingNode,
        uint256 deadline,
        int24 strikeTick
    ) external returns (uint128) {
        ERC20 assetIn = deduceAsset(pool, direction);

        //store pending order
        orderCount = orderCount + 1;
        orders[orderCount] = PendingOrder({
            filled: false,
            orderType: OrderType.STOP_CLOSE,
            owner: msg.sender,
            orderId: orderCount,
            stopData: StopLimitOrder({
                pool: pool,
                targetTick: targetTick,
                amount: amount,
                direction: direction,
                startingNode: startingNode,
                deadline: deadline,
                strikeTick: strikeTick
            })
        });

        //take funds
        assetIn.safeTransferFrom(msg.sender, address(this), amount);
    }

    ///@notice forward @param performData to the LimitOrderRegistry
    function performUpkeep(bytes memory _data) external override {
        pData memory performData = abi.decode(_data, (pData));

        if (performData.orderType == OrderType.LIMIT) {
            //execute on existing Limit Order Registry
            LimitOrderRegistry.performUpkeep(performData.data);
        }

        if (performData.orderType == OrderType.STOP_LIMIT) {
            //create order on Limit Order Registry
            //decode perform data
            //create a new order
            //track order id and associate with eoa
        }

        if (performData.orderType == OrderType.STOP_MARKET) {
            //LimitOrderRegistry.performUpkeep(performData.data);
        }
    }

    ///////////////////////////////////////Perform Upkeep Logic/////////////////////////////////////

    /// @notice loop through all active pools and checkUpkeep on limit order registry for each one
    /// @notice checkData is not used, todo can remove?
    function checkUpkeep(
        bytes calldata /**checkData */
    )
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        //check if we need to fill any standard limit orders
        (upkeepNeeded, performData) = checkLimit();
        if (upkeepNeeded) {
            return (
                upkeepNeeded,
                abi.encode(
                    pData({orderType: OrderType.LIMIT, data: performData})
                )
            );
        }

        //check if we need to fill any stop-limit orders

        //check if we need to fill any stop-market orders
    }

    ///////////////////////////////////////Check Upkeep Logic/////////////////////////////////////

    ///@notice determine if we need to fill any stop-limit orders
    function checkForStop()
        internal
        view
        returns (bool upkeepNeeded, bytes memory performData)
    {
        //loop through list
        //compare current pool tick with strike price
        //createOrder on LOR if we are in range
    }

    ///@notice determine if we need to fill any stop-limit orders
    function checkForStopLimit()
        internal
        view
        returns (bool upkeepNeeded, bytes memory performData)
    {
        //loop through list
        //compare current pool tick with strike price
        //createOrder on LOR if we are in range
    }

    ///@notice determine if we need to fill any orders
    function checkLimit()
        internal
        view
        returns (bool upkeepNeeded, bytes memory performData)
    {
        //loop through all listed pools
        for (uint256 i = 0; i < list.length; i++) {
            (bool needed, bytes memory limitData) = LimitOrderRegistry
                .checkUpkeep(abi.encode(list[i]));

            //short circuit loop when we find a needed upkeep
            if (needed) {
                return (needed, limitData);
            }
        }
    }

    ///////////////////////////////////////Helpers/////////////////////////////////////

    function deduceAsset(
        UniswapV3Pool pool,
        bool direction
    ) internal view returns (ERC20 assetIn) {
        //determine assetIn
        ILimitOrderRegistry.PoolData memory data = LimitOrderRegistry
            .poolToData(pool);
        ERC20 assetIn = direction ? data.token0 : data.token1;
    }
}
