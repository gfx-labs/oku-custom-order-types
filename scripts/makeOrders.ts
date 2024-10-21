import hre, { network } from "hardhat";
import { currentBlock, resetCurrentArb, resetCurrentBase, resetCurrentOP } from "../util/block";
import { AutomationMaster, AutomationMaster__factory, Bracket, Bracket__factory, IERC20, IERC20__factory, IPermit2__factory, StopLimit, StopLimit__factory, UniswapV3Pool__factory } from "../typechain-types";
import { Signer } from "ethers";
import { impersonateAccount } from "../util/impersonator";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { decodeUpkeepData, generateUniTx, generateUniTxData, MasterUpkeepData, permitSingle } from "../util/msc";
import { a, b, o } from "../util/addresser";
import { s, SwapParams } from "../test/triggerV2/scope";
const { ethers } = require("hardhat");


let Master: AutomationMaster
let StopLimit: StopLimit
let Bracket: Bracket
let mainnet = true
let masterAddr: string //"0x8327B0168858bd918A0177e89b2c172475F6B16f"//second deploy//0x4f38FA4F676a053ea497F295f855B2dC3580f517"//initial deploy
let bracketAddr: string
let stopLimitAddr: string
let permitAddr: string

//tokens
let WETH: IERC20
let USDC: IERC20


//SET THIS FOR TESTING
const testingNetwork = "op"
const userAddr = "0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89"
const wethAmount = ethers.parseEther("0.0005")
const stopLimitDelta = ethers.parseUnits("1", 8)
const strikeDelta = ethers.parseUnits("5", 8)
const stopDelta = ethers.parseUnits("5", 8)
const testBips = 2000
let chainId = 42161

async function main() {
    console.log("STARTING")
    let networkName = hre.network.name
    console.log(networkName)

    let [signer] = await ethers.getSigners()

    const network = await ethers.provider.getNetwork();
    chainId = Number(network.chainId)
    console.log("GOT CHAINID: ", chainId)

    if (networkName == "hardhat" || networkName == "localhost") {
        networkName = testingNetwork
        mainnet = false
        console.log("Testing on network : ", networkName)

    } else {
        console.log("Sending for real to: ", networkName)
    }

    if (networkName == "arbitrum") {

        if (!mainnet) {
            await resetCurrentArb()
            console.log("Testing on ARB @", (await currentBlock())?.number)

        }
        masterAddr = a.Master
        stopLimitAddr = a.stopLimit
        bracketAddr = a.bracket
        permitAddr = a.permit2

        WETH = IERC20__factory.connect(a.wethAddress, signer)
        USDC = IERC20__factory.connect(a.nativeUsdcAddress, signer)
    }

    if (networkName == "base") {

        if (!mainnet) {
            await resetCurrentBase()
            console.log("Testing on BASE @", (await currentBlock())?.number)

        }
        masterAddr = b.Master
        stopLimitAddr = b.stopLimit
        bracketAddr = b.bracket
        permitAddr = b.permit2

        WETH = IERC20__factory.connect(b.wethAddress, signer)
        USDC = IERC20__factory.connect(b.nativeUsdcAddress, signer)
    }

    if (networkName == "op") {

        if (!mainnet) {
            await resetCurrentOP()
            console.log("Testing on OP @", (await currentBlock())?.number)

        }
        masterAddr = o.Master
        stopLimitAddr = o.stopLimit
        bracketAddr = o.bracket
        permitAddr = o.permit2

        WETH = IERC20__factory.connect(o.wethAddress, signer)
        USDC = IERC20__factory.connect(o.nativeUsdcAddress, signer)
    }


    Master = AutomationMaster__factory.connect(masterAddr, signer)
    StopLimit = StopLimit__factory.connect(stopLimitAddr, signer)
    Bracket = Bracket__factory.connect(bracketAddr, signer)

    if (!mainnet) {
        signer = await ethers.getSigner(userAddr)

        //testing does not scale tx cost correctly 
        await setBalance(await signer.getAddress(), ethers.parseEther("1"))
        await impersonateAccount(await signer.getAddress())

    }

    //await permitTest(signer)

    //await createStopLimit(signer)
    //await createStopLimitWithPermit(signer)
    //await createBracketWithPermit(signer)
    await createBracketWithSwapAndPermit(signer)
    //await createLimit(signer)
    //await checkOrder(signer)


}

const permitTest = async (signer: Signer) => {
    const PERMIT2 = IPermit2__factory.connect(a.permit2, signer)


    const data = await permitSingle(
        signer,
        chainId,
        a.wethAddress,
        wethAmount,
        a.stopLimit,
        a.permit2,
        4
    )

    await PERMIT2.connect(signer).permit(await signer.getAddress(), data.permitSingle, data.signature, {
        gasLimit: 1000000 // Setting a higher gas limit to force transaction to be sent
    })
}

const createStopLimitWithPermit = async (signer: Signer) => {
    //approve max
    //await WETH.connect(signer).approve(permitAddr, ((2n ** 256n) - 1n))

    //get data
    const data = await permitSingle(
        signer,
        chainId,
        await WETH.getAddress(),
        wethAmount,
        stopLimitAddr,
        permitAddr,
        0
    )
    const currentPrice = await Master.getExchangeRate(await WETH.getAddress(), await USDC.getAddress())

    await StopLimit.connect(signer).createOrderWithPermit(
        currentPrice - stopLimitDelta,
        (currentPrice - stopLimitDelta) + strikeDelta,
        (currentPrice - stopLimitDelta) - stopDelta,
        wethAmount,
        await WETH.getAddress(),
        await USDC.getAddress(),
        await signer.getAddress(),
        testBips,//stop limit bips
        testBips,//stop loss bips
        testBips,//swap on fill bips
        true,//swap on fill
        data.permitSingle,
        data.signature
    )





}

const createBracketWithPermit = async (signer: Signer) => {
    //get data
    const data = await permitSingle(
        signer,
        chainId,
        await WETH.getAddress(),
        wethAmount,
        bracketAddr,
        permitAddr,
        0
    )
    const currentPrice = await Master.getExchangeRate(await WETH.getAddress(), await USDC.getAddress())

    await Bracket.connect(signer).createOrderWithPermit(
        currentPrice + strikeDelta,
        currentPrice - stopDelta,
        wethAmount,
        await WETH.getAddress(),
        await USDC.getAddress(),
        await signer.getAddress(),
        testBips,//stop limit bips
        testBips,//stop loss bips
        data.permitSingle,
        data.signature,
        {
            gasLimit: 1000000 // Setting a higher gas limit to force transaction to be sent
        }
    )
}

const createBracketWithSwapAndPermit = async (signer: Signer) => {
    //get data
    const data = await permitSingle(
        signer,
        chainId,
        await WETH.getAddress(),
        wethAmount,
        stopLimitAddr,
        permitAddr,
        0
    )
    const currentPrice = await Master.getExchangeRate(await WETH.getAddress(), await USDC.getAddress())

    const pool = UniswapV3Pool__factory.connect("0xc31e54c7a869b9fcbecc14363cf510d1c41fa443", signer)

    const swapInData = await generateUniTxData(
        WETH,
        await USDC.getAddress(),
        wethAmount,
        a.uniRouter,
        pool,
        await Bracket.getAddress(),
        await Master.getMinAmountReceived(wethAmount, await WETH.getAddress(), await USDC.getAddress(), testBips)
    )
    const swapParams: SwapParams = {
        swapTokenIn: await USDC.getAddress(),
        swapAmountIn: wethAmount,
        swapTarget: a.uniRouter,
        swapBips: testBips,
        txData: swapInData
    }

    await Bracket.connect(signer).createOrderWithSwapAndPermit(
        swapParams,
        currentPrice + strikeDelta,
        currentPrice - stopDelta,
        await WETH.getAddress(),
        await USDC.getAddress(),
        await signer.getAddress(),
        testBips,//stop limit bips
        testBips,//stop loss bips
        data.permitSingle,
        data.signature,
    )


}

const createStopLimit = async (signer: Signer) => {
    console.log("CREATIGN STOP LIMIT")
    const currentPrice = await Master.getExchangeRate(await WETH.getAddress(), await USDC.getAddress())
    console.log("CURRENT PRICE: ", ethers.formatUnits(currentPrice, 8))

    console.log(ethers.formatEther(await WETH.balanceOf(await signer.getAddress())))

    await WETH.connect(signer).approve(stopLimitAddr, wethAmount)
    await StopLimit.connect(signer).createOrder(
        currentPrice + stopLimitDelta,
        (currentPrice + stopLimitDelta) + strikeDelta,
        (currentPrice + stopLimitDelta) - stopDelta,//no stop loss
        wethAmount,
        await WETH.getAddress(),
        await USDC.getAddress(),
        await signer.getAddress(),
        testBips,//stop limit bips
        testBips,//stop loss bips
        testBips,//swap on fill bips
        true,
        {
            gasLimit: 1000000 // Setting a higher gas limit to force transaction to be sent
        }
    )
}

const checkOrder = async (signer: Signer) => {


    const result = await Master.checkUpkeep("0x")
    console.log(result.upkeepNeeded)

    if (result.upkeepNeeded) {


        const data: MasterUpkeepData = await decodeUpkeepData(result.performData, signer)
        console.log("DECODED", data.txData)//todo

        const minAmountReceived = await Master.getMinAmountReceived(data.amountIn, data.tokenIn, data.tokenOut, data.bips)
        console.log("MAR: ", ethers.formatUnits(minAmountReceived, 6), minAmountReceived)

        const encodedTxData = await generateUniTx(
            a.uniRouter,
            UniswapV3Pool__factory.connect(a.bridgedUsdcPool, signer),
            bracketAddr,
            minAmountReceived,
            data
        )

        await Master.performUpkeep(encodedTxData)
        console.log("DONE")






    }

}


main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
