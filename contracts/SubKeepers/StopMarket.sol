// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;

import "../IMasterKeeperV2.sol";
import "../interfaces/chainlink/AutomationCompatibleInterface.sol";

import "../interfaces/ILimitOrderRegistry.sol";
import "../interfaces/uniswapV3/UniswapV3Pool.sol";
import "../interfaces/uniswapV3/ISwapRouter02.sol";
import "../interfaces/openzeppelin/Ownable.sol";
import "../interfaces/openzeppelin/IERC20.sol";
import "../interfaces/openzeppelin/SafeERC20.sol";

import "../oracle/IOracleRelay.sol";

//import "../interfaces/chainlink/AutomationCompatibleInterface.sol";

///testing
import "hardhat/console.sol";

///@notice This contract owns and handles all logic associated with STOP_MARKET orders
///@notice STOP_MARKET orders check an external oracle for a pre-determined strike price,
///once this price is reached, a market swap occurs
contract StopMarket is Ownable {
    using SafeERC20 for IERC20;

    IMasterKeeperV2 public immutable MASTER;
    ISwapRouter02 public immutable ROUTER;

    struct Order {
        uint256 orderId;
        uint256 strikePrice;
        IOracleRelay assetInOracle;
        ISwapRouter02.ExactInputSingleParams params; //recipient is implied order owner
    }

    event OrderCreated(uint256 orderId);

    ///@notice idx for all orders
    uint256 public orderCount;
    mapping(uint256 => Order) public AllOrders;
    uint256[] public PendingOrderIds;

    //todo consider registering oracles? Or just pass oracle address? just pass for now

    constructor(IMasterKeeperV2 _mkv2, ISwapRouter02 _router) {
        MASTER = _mkv2;
        ROUTER = _router;
    }

    //create order
    function createOrder(Order calldata _order) external {

        orderCount++;
        AllOrders[orderCount] = _order;
        PendingOrderIds.push(orderCount);

        //take asset
        IERC20(_order.params.tokenIn).safeTransferFrom(msg.sender, address(this), _order.params.amountIn);

        //emit
        emit OrderCreated(orderCount);

    }

    //check upkeep

    function checkUpkeep() external view returns (bool upkeepNeeded, bytes memory performData){

    }

    //perform upkeep
}
