// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "../IOracleRelay.sol";
import "../../interfaces/chainlink/IAggregator.sol";
import "../../interfaces/pyth/IPyth.sol";
//import "../../interfaces/openzeppelin/ERC20.sol";



contract PythOracle is IOracleRelay {
    IPyth public immutable pythOracle;
    bytes32 public immutable tokenId;
    uint256 public immutable noOlderThan;
    address public immutable underlying;

    constructor(
        IPyth _pythOraclContract,
        bytes32 _tokenId,
        uint256 _noOlderThan,
        address _underlying
    ) {
        pythOracle = _pythOraclContract;
        tokenId = _tokenId;
        noOlderThan = _noOlderThan;
        underlying = _underlying;
    }

    function currentValue() external view override returns (uint256) {
        IPyth.Price memory price = pythOracle.getPriceUnsafe(tokenId);
        require(
            price.publishTime < block.timestamp - noOlderThan,
            "Stale Price"
        );
        return uint256(uint64(price.price));
    }

    function updatePrice(
        bytes[] calldata priceUpdate
    ) external payable returns (uint256) {
        //check if price is unsafe
        IPyth.Price memory price = pythOracle.getPriceUnsafe(tokenId);

        if (price.publishTime < block.timestamp - noOlderThan) {
            // Submit a priceUpdate to the Pyth contract to update the on-chain price.
            // Updating the price requires paying the fee returned by getUpdateFee.
            // WARNING: These lines are required to ensure the getPriceNoOlderThan call below succeeds. If you remove them, transactions may fail with "0x19abf40e" error.
            uint fee = pythOracle.getUpdateFee(priceUpdate);
            pythOracle.updatePriceFeeds{value: fee}(priceUpdate);

            price = pythOracle.getPriceNoOlderThan(tokenId, uint256(uint64(noOlderThan)));
        }

        //scale price and return
        return uint256(uint64(price.price));
    }
}
