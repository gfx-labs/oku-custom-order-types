import { AbiCoder, AddressLike, BigNumberish, BytesLike, EventLog, Signer, Transaction, TransactionReceipt, TransactionResponse } from "ethers";
import { IERC20, ISwapRouter02, ISwapRouter02__factory, UniswapV3Pool } from "../typechain-types";
import { ethers } from "hardhat";

const abi = new AbiCoder()


export type ExactInputSingleParams = {
    tokenIn: AddressLike,
    tokenOut: AddressLike,
    fee: BigNumberish,
    recipient: AddressLike,
    amountIn: BigNumberish,
    amountOutMinimum: BigNumberish,
    sqrtPriceLimitX96: BigNumberish
}

export type Order = {
    orderId: BigInt,
    strikePrice: BigInt,
    amountIn: BigInt,
    tokenIn: AddressLike,
    tokenOut: AddressLike,
    recipient: AddressLike,
    slippageBips: BigInt,
    direction: Boolean
}

export const getGas = async (result: TransactionResponse) => {

    return Number((await result.wait())?.gasUsed)

}

export const decodeUpkeepData = async (data: BytesLike) => {

    //get pending order idx
    const decoded = abi.decode(
        ["uint256", "tuple(uint256 orderId, uint256 strikePrice, uint256 amountIn, address tokenIn, address tokenOut, address recipient, uint88 slippageBips, bool direction) order"],
        data
    )
    const pendingOrderIdx = decoded[0]
    const order: Order = decoded[1]

    return {
        pendingOrderIdx: pendingOrderIdx,
        order: order
    }

}

export const generateUniTx = async (
    target: AddressLike,
    pendingOrderIdx: BigNumberish,
    router: AddressLike,
    pool: UniswapV3Pool,
    tokenIn: IERC20,
    tokenOut: AddressLike,
    recipient: AddressLike,
    amountIn: BigNumberish,
    amountOutMin: BigNumberish
) => {
    const signer = await ethers.getSigner(recipient.toString())
    const ROUTER = ISwapRouter02__factory.connect(router.toString(), signer)
    const params: ExactInputSingleParams = {
        tokenIn: await tokenIn.getAddress(),
        tokenOut: tokenOut,
        fee: await pool.fee(),
        recipient: recipient,
        amountIn: amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0n
    }

    const txData = (await ROUTER.exactInputSingle.populateTransaction(params)).data

    const encodedPerformData = abi.encode(["address", "uint256", "bytes"], [target, pendingOrderIdx, txData])

    return encodedPerformData
}