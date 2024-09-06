import { AbiCoder, AddressLike, BigNumberish, BytesLike, EventLog, Signer, Transaction, TransactionReceipt, TransactionResponse } from "ethers";
import { IERC20, IERC20__factory, ISwapRouter02, ISwapRouter02__factory, UniswapV3Pool } from "../typechain-types";
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

export enum OrderType {
    LIMIT = 0,
    STOP_LIMIT = 1,
    STOP_LOSS_LIMIT = 2
}
export type MasterUpkeepData = {
    orderType: OrderType,
    target: AddressLike,
    txData: BytesLike,
    pendingOrderIdx: bigint,
    tokenIn: IERC20,
    tokenOut: IERC20,
    amountIn: bigint,
    exchangeRate: bigint
}

export const decodeUpkeepData = async (data: BytesLike, signer: Signer): Promise<MasterUpkeepData> => {
    // Decode the data into a tuple structure
    const decoded = abi.decode(
        ["tuple(uint8 orderType, address target, bytes txData, uint256 pendingOrderIdx, address tokenIn, address tokenOut, uint256 amount, uint256 exchangeRate) order"],
        data
    )[0]; // Unpack the tuple since it returns an array

    // Map the decoded data to the MasterUpkeepData structure
    const upkeepData: MasterUpkeepData = {
        orderType: decoded.orderType as OrderType,
        target: decoded.target,
        txData: decoded.txData,
        pendingOrderIdx: BigInt(decoded.pendingOrderIdx),
        tokenIn: IERC20__factory.connect(decoded.tokenIn, signer),
        tokenOut: IERC20__factory.connect(decoded.tokenOut, signer),
        amountIn: BigInt(decoded.amount),
        exchangeRate: BigInt(decoded.exchangeRate)
    };

    return upkeepData;
}

export const generateUniTxData = async (
    tokenIn: IERC20,
    tokenOut: AddressLike,
    amountIn: bigint,
    router: AddressLike,
    pool: UniswapV3Pool,
    automationContract: AddressLike,
    amountOutMin: bigint
): Promise<BytesLike> => {
    const signer = await ethers.getSigner(automationContract.toString())
    const ROUTER = ISwapRouter02__factory.connect(router.toString(), signer)
    const params: ExactInputSingleParams = {
        tokenIn: await tokenIn.getAddress(),
        tokenOut: tokenOut,
        fee: await pool.fee(),
        recipient: automationContract,
        amountIn: amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0n
    }

    const txData = (await ROUTER.exactInputSingle.populateTransaction(params)).data
    return txData

}


export const generateUniTx = async (
    router: AddressLike,
    pool: UniswapV3Pool,
    automationContract: AddressLike,
    amountOutMin: bigint,
    data: MasterUpkeepData
) => {
    const signer = await ethers.getSigner(automationContract.toString())
    const ROUTER = ISwapRouter02__factory.connect(router.toString(), signer)
    const params: ExactInputSingleParams = {
        tokenIn: await data.tokenIn.getAddress(),
        tokenOut: data.tokenOut,
        fee: await pool.fee(),
        recipient: automationContract,
        amountIn: data.amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0n
    }

    const txData = (await ROUTER.exactInputSingle.populateTransaction(params)).data

    // Encode the MasterUpkeepData struct 
    const encodedMasterUpkeepData = abi.encode(
        ["tuple(uint8 orderType, address target, bytes txData, uint256 pendingOrderIdx, address tokenIn, address tokenOut, uint256 amount, uint256 exchangeRate)"],
        [{
            orderType: data.orderType,
            target: router,              // Set the target to router
            txData: txData,              // Set the txData from the transaction
            pendingOrderIdx: data.pendingOrderIdx,
            tokenIn: await data.tokenIn.getAddress(),
            tokenOut: await data.tokenOut.getAddress(),
            amount: data.amountIn,
            exchangeRate: data.exchangeRate
        }]
    );

    // Return or log the encoded data
    return encodedMasterUpkeepData;

}

/**
//const encodedPerformData = abi.encode(["address", "uint256", "bytes"], [router, pendingOrderIdx, txData])

    //return encodedPerformData
 */

export const getStrikePrice = async (
    currentPrice: bigint,
    delta: number,
    recip: boolean
) => {

    let formatPrice = Number(ethers.formatUnits(currentPrice, 8))

    if (recip) {
        formatPrice = 1 / formatPrice
    }

    let strikePrice = formatPrice + delta

    if (recip) {
        strikePrice = 1 / strikePrice
    }


    return BigInt(ethers.parseUnits(strikePrice.toFixed(8).toString(), 8))

}