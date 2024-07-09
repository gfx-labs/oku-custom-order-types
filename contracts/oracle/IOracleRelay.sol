// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

/// @title OracleRelay Interface
interface IOracleRelay {
  function currentValue() external view returns (uint256 price);
}
