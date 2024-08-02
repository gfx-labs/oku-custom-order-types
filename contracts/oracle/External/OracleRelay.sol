// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "../IOracleRelay.sol";
import "../../interfaces/chainlink/IAggregator.sol";
//import "../../interfaces/openzeppelin/ERC20.sol";

contract OracleRelay is IOracleRelay {
    IAggregator public immutable aggregator;

    address public immutable underlying;

    //uint8 private immutable units;

    constructor(address _underlying, IAggregator _aggregator) {
        underlying = _underlying;
        aggregator = _aggregator;
        //units = ERC20(_underlying).decimals();

    }

    function currentValue() external view override returns (uint256) {
        int256 latest = aggregator.latestAnswer();
        require(latest > 0, "chainlink: px < 0");

        //scale


        return uint256(latest);
    }
}
