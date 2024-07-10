// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "./IMasterKeeperV2.sol";

import "./interfaces/chainlink/AutomationCompatibleInterface.sol";
import "./interfaces/openzeppelin/Ownable.sol";
import "./interfaces/openzeppelin/ERC20.sol";
import "./interfaces/openzeppelin/SafeTransferLib.sol";
import "./interfaces/uniswapV3/UniswapV3Pool.sol";
import "./libraries/ArrayMutation.sol";
import "./interfaces/ILimitOrderRegistry.sol";

import "./oracle/IOracleRelay.sol";

///testing
import "hardhat/console.sol";

///@notice V2 - Includes logic for stop and stop-limit orders
///@notice Only stop and stop-limit orders can be pending, and pending orders are tracked by this contract until the strike price is reached
///@notice This contract serves as a single keeper to handle upkeep for all pools in the LimitOrderRegistry
///@notice New pools will need to be added here for this upkeep to track them
contract MasterKeeperV2 is IMasterKeeperV2, Ownable {
    using SafeTransferLib for ERC20;

    ILimitOrderRegistry public LimitOrderRegistry;

    ///@notice list of registered pools to watch for standard limit orders via Limit Order Registry
    UniswapV3Pool[] public list;

    ///@notice idx for all orders
    uint256 public orderCount;

    ///@notice Store all orders by order Id
    mapping(uint256 => Order) public orders;

    ///@notice Actively pending orders
    Order[] public PendingOrders;

    ///@notice associate each pool with its oracle contracts
    ///@notice each pool is mapped to an array of exactly length 2,
    ///where idx 0 is the oracle for token0, and idx 1 is the oracle for token1
    mapping(UniswapV3Pool => IOracleRelay[]) public oracles;

    constructor(ILimitOrderRegistry _LimitOrderRegistry) {
        LimitOrderRegistry = _LimitOrderRegistry;
    }

    function getOracles(
        UniswapV3Pool pool
    ) external view override returns (IOracleRelay[] memory) {
        return oracles[pool];
    }

    ///@notice get the current list of tracked pools for the Limit Order Registry
    function getList()
        external
        view
        returns (UniswapV3Pool[] memory currentList)
    {
        currentList = list;
    }

    ///@notice get the current list of pending orders (STOP orders only)
    function getPendingOrders()
        external
        view
        returns (Order[] memory currentPendingOrders)
    {
        currentPendingOrders = PendingOrders;
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

    function registerOracles(
        OracleInput[] memory _oracles,
        UniswapV3Pool[] memory _pools
    ) external onlyOwner {
        require(_oracles.length == _pools.length, "array length mismatch");
        for (uint i = 0; i < _pools.length; i++) {
            oracles[_pools[i]] = [_oracles[i].oracle0, _oracles[i].oracle1];
        }
    }

    ///////////////////////////////////////Close Limit Order/////////////////////////////////////
    ///@notice claim complete stop-close or stop-limit orders
    function claimOrder(
        uint256 orderId,
        address user
    ) external payable returns (ERC20 tokenOut, uint256 owed) {
        //get pending order
        Order memory order = orders[orderId];
        //verify owner
        require(user != address(this), "Contract is Recipient");
        require(
            order.owner == msg.sender || order.owner == user,
            "Only Order Owner"
        );

        //claim on LOR
        (tokenOut, owed) = LimitOrderRegistry.claimOrder(order.batchId, user);

        //mark as complete
        orders[orderId].status = Status.CLAIMED;
    }

    function cancelOrder(
        uint256 orderId,
        uint256 deadline
    ) external returns (uint128 amount0, uint128 amount1, uint128 batchId) {
        //get pending order
        Order memory order = orders[orderId];
        //verify owner
        require(order.owner == msg.sender, "Only Order Owner");

        (amount0, amount1, batchId) = LimitOrderRegistry.cancelOrder(
            order.stopData.pool,
            order.stopData.targetTick,
            order.stopData.direction,
            deadline
        );

        //send funds

        //mark as complete
        orders[orderId].status = Status.CANCELLED;
    }

    ///////////////////////////////////////Create Order Types/////////////////////////////////////

    ///@notice this type of order will simply execute a market swap at the stop price
    function createMarketStopOrder(
        UniswapV3Pool pool,
        uint128 amount,
        bool direction,
        uint256 minAmountReceived,
        uint256 deadline,
        uint256 strikePrice
    ) external {
        //todo ensure current tick > strikePrice
        //market swap at strike tick

        //store pending order
        orderCount = orderCount + 1;
        orders[orderCount] = Order({
            orderId: orderCount,
            status: Status.PENDING,
            orderType: OrderType.STOP_MARKET,
            owner: msg.sender,
            strikePrice: strikePrice,
            batchId: 0,
            assetInOracle: direction ? oracles[pool][0] : oracles[pool][1], //todo verify current price is valid
            stopData: StopLimitOrder({
                pool: pool,
                targetTick: 0, //no target tick for market swap
                amount: amount,
                direction: direction,
                startingNode: minAmountReceived,
                deadline: deadline
            })
        });

        //push pending order
        PendingOrders.push(orders[orderCount]);

        //take funds
        ERC20 assetIn = deduceAsset(pool, direction);
        assetIn.safeTransferFrom(msg.sender, address(this), amount);

        emit OrderCreated(OrderType.STOP_MARKET, orderCount);
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
        uint256 strikePrice
    ) external returns (uint128) {
        //store pending order
        orderCount = orderCount + 1;
        orders[orderCount] = Order({
            orderId: orderCount,
            status: Status.PENDING,
            orderType: OrderType.STOP_CLOSE,
            owner: msg.sender,
            strikePrice: strikePrice,
            batchId: 0, //this will be set once the strike price is reached todo
            assetInOracle: direction ? oracles[pool][0] : oracles[pool][1], //todo verify current price is valid
            stopData: StopLimitOrder({
                pool: pool,
                targetTick: targetTick,
                amount: amount,
                direction: direction,
                startingNode: startingNode,
                deadline: deadline
            })
        });

        //push pending order
        PendingOrders.push(orders[orderCount]);

        //take funds
        ERC20 assetIn = deduceAsset(pool, direction);
        assetIn.safeTransferFrom(msg.sender, address(this), amount);

        emit OrderCreated(OrderType.STOP_CLOSE, orderCount);
    }

    ///////////////////////////////////////Perform Upkeep Logic/////////////////////////////////////

    ///@notice forward @param performData to the LimitOrderRegistry
    function performUpkeep(bytes memory _data) external override {
        PerformData memory performData = abi.decode(_data, (PerformData));

        if (performData.orderType == OrderType.LIMIT) {
            //execute on existing Limit Order Registry
            LimitOrderRegistry.performUpkeep(performData.data);
        }

        if (performData.orderType == OrderType.STOP_LIMIT) {}

        if (performData.orderType == OrderType.STOP_MARKET) {
            //todo
        }

        if (performData.orderType == OrderType.STOP_CLOSE) {
            //todo
        }
    }

    ///@notice strike price reached, create limit order
    function performStopLimit(
        bytes memory performData
    ) internal returns (bool filled) {
        //todo

        //decode
        StopLimitOrder memory orderData = abi.decode(
            performData,
            (StopLimitOrder)
        );

        //newOrder
        try
            LimitOrderRegistry.newOrder(
                orderData.pool,
                orderData.targetTick,
                orderData.amount,
                orderData.direction,
                orderData.startingNode,
                orderData.deadline
            )
        {
            //order.status = Status.FILLED;
            filled = true;
        } catch {
            //todo mark complete
            filled = false;
            //order.status = Status.CANCELLED;
        }
        //handle for failure, mark as filled
    }

    ///@notice strike price reached, perform market swap
    function performStopMarket(bytes memory performData) internal {
        //todo
        //decode
        //try swap with recipient being the user addr, mark complete
        //if swap fails, send tokenIn and mark canceled
    }

    ///@notice strike price reached, close limit order
    function performStopClose(bytes memory performData) internal {
        //todo
    }

    ///////////////////////////////////////Check Upkeep Logic/////////////////////////////////////
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
                    PerformData({
                        orderType: OrderType.LIMIT,
                        orderId: 0,
                        data: performData
                    })
                )
            );
        }

        //check if we need to fill any stop-limit orders

        //check if we need to fill any stop-market orders
    }

    ///@notice determine if we need to fill any standard limit orders
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

    ///@notice determine if we need to fill any stop-market orders
    function checkForStopMarket()
        internal
        view
        returns (bool upkeepNeeded, bytes memory performData)
    {
        //loop through list
        //compare current pool tick with strike price
        //createOrder on LOR if we are in range
    }

    ///@notice determine if we need to fill any stop-close orders
    function checkForStopClose()
        internal
        view
        returns (bool upkeepNeeded, bytes memory performData)
    {
        //loop through list
        //compare current pool tick with strike price
        //createOrder on LOR if we are in range
    }

    ///////////////////////////////////////Helpers/////////////////////////////////////

    function deduceAsset(
        UniswapV3Pool pool,
        bool direction
    ) internal view returns (ERC20 assetIn) {
        //determine assetIn
        ILimitOrderRegistry.PoolData memory data = LimitOrderRegistry
            .poolToData(pool);
        return direction ? data.token0 : data.token1;
    }
}
