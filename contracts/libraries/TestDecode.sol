// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/uniswapV3/IPermit2.sol";
import "../automatedTrigger/IAutomation.sol";

import "hardhat/console.sol";

contract TestDecode {
    function decodePermitSingle(
        bytes calldata permitPayload
    ) external pure returns (IPermit2.PermitSingle memory single) {
        single = abi.decode(permitPayload, (IPermit2.PermitSingle));
        console.log("DECODED SINGLE");
        console.log(single.details.token);
        console.log(single.details.amount);
        console.log(single.details.expiration);
        console.log(single.details.nonce);
        console.log(single.spender);
        console.log(single.sigDeadline);
    }

    function decodePermit2Payload(
        bytes calldata permitPayload
    ) external pure returns (IAutomation.Permit2Payload memory payload) {
        payload = abi.decode(permitPayload, (IAutomation.Permit2Payload));
        console.log("DECODED PAYLOAD");
        console.log(payload.permitSingle.details.token);
        console.log(payload.permitSingle.details.amount);
        console.log(payload.permitSingle.details.expiration);
        console.log(payload.permitSingle.details.nonce);
        console.log(payload.permitSingle.spender);
        console.log(payload.permitSingle.sigDeadline);
        console.logBytes(payload.signature);
    }
}
