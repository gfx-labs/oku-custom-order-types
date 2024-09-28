import { AbiCoder, AddressLike, BigNumberish, BytesLike, Signer, TransactionResponse } from "ethers"
import { IERC20, IERC20__factory, ISwapRouter02__factory, UniswapV3Pool } from "../typechain-types"
import { ethers } from "hardhat"

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
    orderId: bigint, 
    strikePrice: bigint,
    amountIn: bigint,
    tokenIn: AddressLike,
    tokenOut: AddressLike,
    recipient: AddressLike,
    slippageBips: bigint,
    direction: boolean 
}

export const getGas = async (result: TransactionResponse) => {
    return Number((await result.wait())?.gasUsed)
}

export enum OrderType {
    STOP_LIMIT = 0,
    STOP_LOSS_LIMIT = 1
}

export type MasterUpkeepData = {
    orderType: OrderType,
    target: AddressLike,
    tokenIn: IERC20,
    tokenOut: IERC20,
    orderId: bigint,
    pendingOrderIdx: bigint,
    bips: bigint,
    amountIn: bigint,
    exchangeRate: bigint,
    txData: BytesLike
}

export const MasterUpkeepTuple = "tuple(uint8 orderType, address target, address tokenIn, address tokenOut, uint96 orderId, uint16 pendingOrderIdx, uint88 bips, uint256 amountIn, uint256 exchangeRate, bytes txData)"

export const decodeUpkeepData = async (data: BytesLike, signer: Signer): Promise<MasterUpkeepData> => {
    // Decode the data into a tuple structure
    const decoded = abi.decode(
        [MasterUpkeepTuple],
        data
    )[0] // Unpack the tuple since it returns an array

    // Map the decoded data to the MasterUpkeepData structure
    const upkeepData: MasterUpkeepData = {
        orderType: decoded.orderType as OrderType,
        target: decoded.target,
        tokenIn: IERC20__factory.connect(decoded.tokenIn, signer),
        tokenOut: IERC20__factory.connect(decoded.tokenOut, signer),
        orderId: BigInt(decoded.orderId),
        pendingOrderIdx: BigInt(decoded.pendingOrderIdx),
        bips: BigInt(decoded.bips),
        amountIn: BigInt(decoded.amountIn),
        exchangeRate: BigInt(decoded.exchangeRate),
        txData: decoded.txData 
    }

    return upkeepData
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
        tokenOut: await data.tokenOut.getAddress(), 
        fee: await pool.fee(),
        recipient: automationContract,
        amountIn: data.amountIn,
        amountOutMinimum: amountOutMin,
        sqrtPriceLimitX96: 0n
    }

    const txData = (await ROUTER.exactInputSingle.populateTransaction(params)).data

    // Encode the MasterUpkeepData struct 
    const encodedMasterUpkeepData = abi.encode(
        [MasterUpkeepTuple],
        [{
            orderType: data.orderType,
            target: router, 
            tokenIn: await data.tokenIn.getAddress(),
            tokenOut: await data.tokenOut.getAddress(),
            orderId: data.orderId,
            pendingOrderIdx: data.pendingOrderIdx,
            bips: data.bips,
            amountIn: data.amountIn,
            exchangeRate: data.exchangeRate,
            txData: txData 
        }]
    )

    return encodedMasterUpkeepData
}