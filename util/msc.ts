import { AddressLike, BigNumberish, EventLog, Signer } from "ethers";
import { IERC20, ISwapRouter02, ISwapRouter02__factory, UniswapV3Pool } from "../typechain-types";
import { ethers } from "hardhat";
export type ExactInputSingleParams = {
    tokenIn: AddressLike,
    tokenOut: AddressLike,
    fee: BigNumberish,
    recipient: AddressLike,
    amountIn: BigNumberish,
    amountOutMinimum: BigNumberish,
    sqrtPriceLimitX96: BigNumberish
}
export const getEvent = async (result: any, event: string) => {
    const receipt = await result.wait()
    console.log(result)
}

export const generateUniTx = async (
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

    return {
        data: (await ROUTER.exactInputSingle.populateTransaction(params)).data,
        params: params
    }
}