// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;


import "./interfaces/chainlink/AutomationCompatibleInterface.sol";
import "./interfaces/openzeppelin/Ownable.sol";
import "./interfaces/uniswapV3/UniswapV3Pool.sol";
import "./libraries/ArrayMutation.sol";

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract MasterKeeper is Ownable, AutomationCompatibleInterface{
    
    AutomationCompatibleInterface public LimitOrderRegistry;

    UniswapV3Pool[] public list;

    constructor (AutomationCompatibleInterface _LimitOrderRegistry) {
        LimitOrderRegistry = _LimitOrderRegistry;
    }

    function addPool(UniswapV3Pool pool) external onlyOwner {
        list.push(pool);
    }

    function clearPool() external onlyOwner {
        list = new UniswapV3Pool[](0);
    }

    function removePool(uint256 idx) external onlyOwner {
        list = ArrayMutation.removeFromArray(idx, list);
    }


    /// @notice loop through all active pools and checkUpkeep on limit order registry for each one
    /// @notice @param checkData is not used, todo can remove?
    function checkUpkeep(bytes calldata checkData) external view override returns (bool upkeepNeeded, bytes memory performData){
        //loop through all listed pools, short circuit loop when we find a needed upkeep
        for(uint256 i = 0; i < list.length; i++){
            (bool needed, bytes memory pData) = LimitOrderRegistry.checkUpkeep(abi.encode(list[i]));
            if(needed){
                return (needed, pData);
            }
        }
    }

    function performUpkeep(bytes calldata performData) external override {
        LimitOrderRegistry.performUpkeep(performData);
    }


}
