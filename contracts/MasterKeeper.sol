// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.19;


import "./interfaces/chainlink/AutomationCompatibleInterface.sol";
import "./interfaces/openzeppelin/Ownable.sol";
import "./interfaces/uniswapV3/UniswapV3Pool.sol";
import "./libraries/ArrayMutation.sol";

///@notice This contract serves as a single keeper to handle upkeep for all pools in the LimitOrderRegistry
///@notice New pools will need to be added here for this upkeep to track them
contract MasterKeeper is Ownable, AutomationCompatibleInterface{
    
    AutomationCompatibleInterface public LimitOrderRegistry;

    UniswapV3Pool[] public list;

    constructor (AutomationCompatibleInterface _LimitOrderRegistry) {
        LimitOrderRegistry = _LimitOrderRegistry;
    }

    ///@notice get the current list of tracked pools
    function getList() external view returns (UniswapV3Pool[] memory currentList){
        currentList = list;
    }

    ///@notice add a new @param pool to the list
    function addPool(UniswapV3Pool pool) external onlyOwner {
        list.push(pool);
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

    /// @notice loop through all active pools and checkUpkeep on limit order registry for each one
    /// @notice checkData is not used, todo can remove?
    function checkUpkeep(bytes calldata /**checkData */) external view override returns (bool upkeepNeeded, bytes memory performData){
        //loop through all listed pools
        for(uint256 i = 0; i < list.length; i++){
            (bool needed, bytes memory pData) = LimitOrderRegistry.checkUpkeep(abi.encode(list[i]));
            
            //short circuit loop when we find a needed upkeep
            if(needed){
                return (needed, pData);
            }
        }
    }

    ///@notice forward @param performData to the LimitOrderRegistry
    function performUpkeep(bytes calldata performData) external override {
        LimitOrderRegistry.performUpkeep(performData);
    }
}
