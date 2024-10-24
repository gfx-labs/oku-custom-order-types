// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;
import "../interfaces/uniswapV3/UniswapV3Pool.sol";

library ArrayMutation {
  ///@param idx the element to remove from @param inputArray
  function removeFromArray(uint idx, UniswapV3Pool[] memory inputArray) internal pure returns (UniswapV3Pool[] memory newList) {
    //if length == 0, return false / revert?
    require(inputArray.length > 0, "inputArray length == 0");

    //if length == 1, reset to empty array
    if (inputArray.length == 1) {
      return new UniswapV3Pool[](0);
    }

    UniswapV3Pool finalElement = inputArray[inputArray.length - 1];

    //if final element == deleted element, simply return the array minus the final element
    if (finalElement == inputArray[idx]) {
      newList = new UniswapV3Pool[](inputArray.length - 1);
      for (uint k = 0; k < newList.length; k++) {
        newList[k] = inputArray[k];
      }

      return newList;
    }

    //if not the final element, replace the withdrawn idx with the final element
    inputArray[idx] = finalElement;

    newList = new UniswapV3Pool[](inputArray.length - 1);
    for (uint j = 0; j < newList.length; j++) {
      newList[j] = inputArray[j];
    }
    return newList;
  }

  ///@param idx the element to remove from @param inputArray
function removeFromArray(uint96 idx, uint96[] memory inputArray) internal pure returns (uint96[] memory newList) {
    // Check that inputArray is not empty and idx is valid
    require(inputArray.length > 0, "inputArray length == 0");
    require(idx < inputArray.length, "index out of bounds");

    // Create a new array of the appropriate size
    newList = new uint96[](inputArray.length - 1);

    // Copy elements before the index
    for (uint96 i = 0; i < idx; i++) {
        newList[i] = inputArray[i];
    }

    // Copy elements after the index
    for (uint96 i = idx + 1; i < inputArray.length; i++) {
        newList[i - 1] = inputArray[i];
    }

    return newList;
}


  
}
