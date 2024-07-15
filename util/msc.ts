import { AddressLike, BigNumberish, EventLog, Signer } from "ethers";
import { IERC20, ISwapRouter02, ISwapRouter02__factory, UniswapV3Pool } from "../typechain-types";
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
    souorce: AddressLike,//sender of uni bytecode
    router: AddressLike,
    pool: UniswapV3Pool,
    tokenIn: IERC20,
    tokenOut: AddressLike,
    recipient: Signer,
    amountIn: BigNumberish,
    amountOutMin: BigNumberish
) => {
    const ROUTER = ISwapRouter02__factory.connect(router.toString(), recipient)
    const params: ExactInputSingleParams = {
        tokenIn: await tokenIn.getAddress(),
        tokenOut: tokenOut,
        fee: await pool.fee(),
        recipient: await recipient.getAddress(),
        amountIn: amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0n
    }

    return {
        data: (await ROUTER.exactInputSingle.populateTransaction(params)).data,
        params: params
    }
}