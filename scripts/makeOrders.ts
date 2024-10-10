import hre, { network } from "hardhat";
import { DeployContract } from "../util/deploy";
import { currentBlock, resetCurrent, resetCurrentArb, resetCurrentBase, resetCurrentBsc, resetCurrentOP, resetCurrentOPblock, resetCurrentPoly, resetCurrentZksync } from "../util/block";
import { AutomationMaster, AutomationMaster__factory, IERC20, IERC20__factory, IOracleRelay, IPermit2__factory, MasterKeeper, MasterKeeper__factory, OracleRelay__factory, StopLimit, StopLimit__factory, StopLossLimit, StopLossLimit__factory, UniswapV3Pool__factory } from "../typechain-types";
import { limitOrderData } from "./limitOrderData";
import { Signer, TypedDataDomain } from "ethers";
import { ceaseImpersonation, impersonateAccount } from "../util/impersonator";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { decodeUpkeepData, generateUniTx, MasterUpkeepData } from "../util/msc";
import { a, o } from "../util/addresser";
import { s } from "../test/triggerV2/scope";
import { AllowanceTransfer } from "@uniswap/permit2-sdk";
const { ethers } = require("hardhat");


let Master: AutomationMaster
let StopLimit: StopLimit
let StopLossLimit: StopLossLimit
let mainnet = true
let masterAddr: string //"0x8327B0168858bd918A0177e89b2c172475F6B16f"//second deploy//0x4f38FA4F676a053ea497F295f855B2dC3580f517"//initial deploy
let stopLossLimitAddr: string
let stopLimitAddr: string
let permitAddr: string

//tokens
let WETH: IERC20
let USDC: IERC20


//SET THIS FOR TESTING
const testingNetwork = "arbitrum"
const userAddr = "0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89"
const wethAmount = ethers.parseEther("0.0001")//~$0.12
const stopLimitDelta = ethers.parseUnits("1", 8)
const strikeDelta = ethers.parseUnits("5", 8)
const stopDelta = ethers.parseUnits("5", 8)
const testBips = 2000

async function main() {
    console.log("STARTING")
    let networkName = hre.network.name
    console.log(networkName)

    let [signer] = await ethers.getSigners()


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
        stopLossLimitAddr = a.stopLossLimit
        permitAddr = a.permit2

        WETH = IERC20__factory.connect(a.wethAddress, signer)
        USDC = IERC20__factory.connect(a.nativeUsdcAddress, signer)
    }


    Master = AutomationMaster__factory.connect(masterAddr, signer)
    StopLimit = StopLimit__factory.connect(stopLimitAddr, signer)
    //StopLossLimit = StopLossLimit__factory.connect(stopLossLimitAddr, signer)

    if (!mainnet) {
        signer = await ethers.getSigner(userAddr)

        //testing does not scale tx cost correctly 
        await setBalance(await signer.getAddress(), ethers.parseEther("1"))
        await impersonateAccount(await signer.getAddress())

    }

    await permitTest(signer)

    //await createStopLimit(signer)
    //await createLimit(signer)
    //await checkOrder(signer)


}

const permitTest = async (signer: Signer) => {
    const chainId = 42161
    const expiration = Math.floor(Date.now() / 1000) + 60 * 60 // 1 hour from now
    const nonce = 0

    const PERMIT2 = IPermit2__factory.connect(a.permit2, signer)

    type PermitDetails = {
        token: string
        amount: string
        expiration: string
        nonce: string
    }

    type PermitSingle = {
        details: PermitDetails
        spender: string
        sigDeadline: string
    }

    // Construct PermitDetails
    const permitDetails: PermitDetails = {
        token: a.wethAddress,
        amount: wethAmount,
        expiration: expiration.toString(),
        nonce: nonce.toString()
    };

    // Construct PermitSingle
    const permitSingle: PermitSingle = {
        details: permitDetails,
        spender: a.stopLimit,
        sigDeadline: (expiration + 86400).toString()
    };

    const { domain, types, values } = AllowanceTransfer.getPermitData(permitSingle, a.permit2, chainId)

    // Sign permit data
    const signature = await signer.signTypedData(domain as TypedDataDomain, types, permitSingle);
    console.log(signature)

    await PERMIT2.connect(signer).permit(await signer.getAddress(), permitSingle, signature, {
        gasLimit: 1000000 // Setting a higher gas limit to force transaction to be sent
    })
}


const createStopLimit = async (signer: Signer) => {

    const currentPrice = await Master.getExchangeRate(await WETH.getAddress(), await USDC.getAddress())
    console.log("CURRENT PRICE: ", ethers.formatUnits(currentPrice, 8))

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
        true//swap on fill
    )
}

const createLimit = async (signer: Signer) => {
    const currentPrice = await Master.getExchangeRate(await WETH.getAddress(), await USDC.getAddress())
    console.log("CURRENT PRICE: ", ethers.formatUnits(currentPrice, 8))

    await WETH.connect(signer).approve(stopLossLimitAddr, wethAmount)
    await StopLossLimit.connect(signer).createOrder(
        currentPrice + strikeDelta,
        currentPrice - stopDelta,
        wethAmount,
        await WETH.getAddress(),
        await USDC.getAddress(),
        await signer.getAddress(),
        testBips,
        testBips
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
            stopLossLimitAddr,
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
