import hre, { network } from "hardhat";
import { currentBlock, resetCurrentArb, resetCurrentBase, resetCurrentOP } from "../util/block";
import { AutomationMaster, AutomationMaster__factory, Bracket, Bracket__factory, IERC20, IERC20__factory, IPermit2__factory, StopLimit, StopLimit__factory, UniswapV3Pool__factory } from "../typechain-types";
import { AbiCoder, Signer, TypedDataDomain } from "ethers";
import { impersonateAccount } from "../util/impersonator";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { decodeUpkeepData, generateUniTx, generateUniTxData, MasterUpkeepData, permitSingle } from "../util/msc";
import { a, b, o } from "../util/addresser";
import { s, SwapParams } from "../test/triggerV2/scope";
import { DeployContract } from "../util/deploy";
import { AllowanceTransfer, PermitDetails, PermitSingle } from "@uniswap/permit2-sdk";
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
            console.log("RESETTING TO OP")
            await resetCurrentOP()
            console.log("Testing on OP @", (await currentBlock())?.number)
            chainId = Number(network.chainId)
            console.log("GOT CI: ", chainId)
        } else {
            chainId = 10
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

        //testing does not scale tx cost correctly 
        await setBalance(await signer.getAddress(), ethers.parseEther("1"))
        await impersonateAccount(await signer.getAddress())
        signer = await ethers.getSigner(userAddr)
        console.log("IMPERSONATED")

    }
    const delta = ethers.parseUnits("50", 8)

    /**
    await createStopLimitOrder(signer, delta)
    await createStopLimitOrder(signer, delta * 2n)
    await createStopLimitOrder(signer, delta * 3n)
    await createBracketOrder(signer, delta)
    await createBracketOrder(signer, delta * 2n)
    await createBracketOrder(signer, delta * 3n)
     */
    await createBracketPermit(signer)
    //await testDecode()


}

const createBracketOrder = async (signer: Signer, delta: bigint) => {
    const currentPrice = await Master.getExchangeRate(await WETH.getAddress(), await USDC.getAddress())
    await WETH.connect(signer).approve(await Bracket.getAddress(), wethAmount)

    await Bracket.connect(signer).createOrder(
        "0x",
        currentPrice + delta,
        currentPrice - delta,
        wethAmount,
        await WETH.getAddress(),
        await USDC.getAddress(),
        await signer.getAddress(),
        5,
        500,
        500,
        false,
        "0x"
    )
}

const createStopLimitOrder = async (signer: Signer, delta: bigint) => {


    const currentPrice = await Master.getExchangeRate(await WETH.getAddress(), await USDC.getAddress())
    await WETH.connect(signer).approve(await StopLimit.getAddress(), wethAmount)
    await StopLimit.connect(signer).createOrder(
        currentPrice - delta,
        currentPrice + delta,
        currentPrice - (delta * 2n),
        wethAmount,
        await WETH.getAddress(),
        await USDC.getAddress(),
        await signer.getAddress(),
        5,
        500,
        500,
        500,
        true,
        false,
        "0x"
    )



}

const testDecode = async () => {

    //clean slate
    await resetCurrentOP()
    const signer = await ethers.getSigner(userAddr)

    await setBalance(await signer.getAddress(), ethers.parseEther("1"))
    await impersonateAccount(await signer.getAddress())
    console.log("IMPERSONATED", await signer.getAddress())

    let newBracket: Bracket
    newBracket = await DeployContract(new Bracket__factory(signer), signer, masterAddr, o.permit2)

    const abi = new AbiCoder()
    const permit = {
        signature: '0xa60d1e049b3f3444bbf564b25dfe8f27e6110ccdb24088c260926e2d3e4e7f0f7ee32c681d1536b1c6a839c7993035bc0726f3ba1b4e296ffe98929a65d5389f1b',
        permitSingle: {
            details: {
                token: '0x4200000000000000000000000000000000000006',
                amount: '500000000000000',
                expiration: '1732572972',
                nonce: '0'
            },
            spender: '0xA90307cF7EE55eb6DEA5f55F37101c02b0a55acE',
            sigDeadline: '1732659372'
        }
    }
    const types = [
        "(((address,uint160,uint48,uint48),address,uint256),bytes)"
    ];

    const values = [
        [
            [
                [
                    permit.permitSingle.details.token,
                    permit.permitSingle.details.amount,
                    permit.permitSingle.details.expiration,
                    permit.permitSingle.details.nonce
                ],
                permit.permitSingle.spender,
                permit.permitSingle.sigDeadline
            ],
            permit.signature
        ]
    ];

    const encoded = encode(permit)
    console.log(encoded)

    await newBracket.decodePermit(encoded)

    /**
    const types = [
        "tuple(tuple(address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline)"
    ];
     */






}

const encode = (permit: any) => {
    const types = [
        "(((address,uint160,uint48,uint48),address,uint256),bytes)"
    ];

    const values = [
        [
            [
                [
                    permit.permitSingle.details.token,
                    permit.permitSingle.details.amount,
                    permit.permitSingle.details.expiration,
                    permit.permitSingle.details.nonce
                ],
                permit.permitSingle.spender,
                permit.permitSingle.sigDeadline
            ],
            permit.signature
        ]
    ];
    const abi = new AbiCoder()
    const encoded = abi.encode(types, values)

    return encoded
}

const createBracketPermit = async (signer: Signer) => {


    //determine if permit2 is approved already
    const allowance = await WETH.allowance(await signer.getAddress(), o.permit2)
    console.log("ALLOWANCE: ", allowance)
    if (allowance < wethAmount) {
        await WETH.connect(signer).approve(o.permit2, wethAmount * 5000n)
    }

    //get permitSingle
    let permit = await permitSingle(
        signer,
        chainId,
        await WETH.getAddress(),
        wethAmount,
        await Bracket.getAddress(),
        o.permit2
    )

    const encodedPayload = encode(permit)
    const currentPrice = await Master.getExchangeRate(await WETH.getAddress(), await USDC.getAddress())
    const delta = ethers.parseUnits("50", 8)
    await Bracket.connect(signer).createOrder(
        "0x",
        currentPrice + delta,
        currentPrice - (delta * 2n),
        wethAmount,
        await WETH.getAddress(),
        await USDC.getAddress(),
        await signer.getAddress(),
        5,
        500,
        500,
        true,
        encodedPayload
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
