import hre, { network } from "hardhat";
import { currentBlock, resetCurrentArb, resetCurrentBase, resetCurrentOP } from "../util/block";
import { AutomationMaster, AutomationMaster__factory, Bracket, Bracket__factory, IERC20, IERC20__factory, IPermit2__factory, OracleLess, OracleLess__factory, PermitTest, PermitTest__factory, StopLimit, StopLimit__factory, UniswapV3Pool__factory } from "../typechain-types";
import { AbiCoder, getBytes, Signer } from "ethers";
import { impersonateAccount } from "../util/impersonator";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { decodeUpkeepData, encodePermit2Payload, encodePermitSingle, generateUniTx, generateUniTxData, MasterUpkeepData, MasterUpkeepTuple, Permit2Payload, permitSingle } from "../util/msc";
import { a, b, o } from "../util/addresser";
import { s, SwapParams } from "../test/triggerV2/scope";
import { ChainAddresses, OptimisimAddresses } from "../util/deploymentAddresses";
import { DeployContract } from "../util/deploy";
const { ethers } = require("hardhat");
const abi = new AbiCoder()



//SET THIS FOR TESTING
const testingNetwork = "op"
const userAddr = "0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89"
const wethAmount = ethers.parseEther("0.0005")
const stopLimitDelta = ethers.parseUnits("1", 8)
const strikeDelta = ethers.parseUnits("5", 8)
const stopDelta = ethers.parseUnits("5", 8)

let master: AutomationMaster
let stopLimit: StopLimit
let bracket: Bracket
let oracleLess: OracleLess
let mainnet = true
let permitAddr: string
let chainId = 42161
let addrs: ChainAddresses

//tokens
let WETH: IERC20
let USDC: IERC20

const main = async () => {
    console.log("STARTING")
    let networkName = hre.network.name
    console.log("Running on: ", networkName)
    const network = await ethers.provider.getNetwork();
    chainId = Number(network.chainId)

    let [signer] = await ethers.getSigners()


    if (networkName == "hardhat" || networkName == "localhost") {
        networkName = testingNetwork
        mainnet = false
        console.log("Testing on network : ", networkName)
    } else {
        console.log("RUNNING ON LIVE NETWORK: ", networkName)
    }

    if (networkName == "op") {
        if (!mainnet) {
            console.log("RESETTING TO OP")
            await resetCurrentOP()
            console.log("Testing on OP @", (await currentBlock())?.number)
            chainId = 10
            signer = await ethers.getSigner(userAddr)

            //testing does not scale tx cost correctly 
            await setBalance(await signer.getAddress(), ethers.parseEther("1"))
            await impersonateAccount(await signer.getAddress())
        } else {
            chainId = Number(network.chainId)
            console.log("GOT CI: ", chainId)
        }

        addrs = new OptimisimAddresses()
    }

    master = AutomationMaster__factory.connect(addrs.coreDeployments.master, signer)
    stopLimit = StopLimit__factory.connect(addrs.coreDeployments.stopLimit, signer)
    bracket = Bracket__factory.connect(addrs.coreDeployments.bracket, signer)
    oracleLess = OracleLess__factory.connect(addrs.coreDeployments.oracleLess, signer)
    WETH = IERC20__factory.connect((addrs.allTokens.find(token => token.symbol === "WETH"))!.token, signer)
    USDC = IERC20__factory.connect((addrs.allTokens.find(token => token.symbol === "USDC"))!.token, signer)

    //await createStopLimitOrder(signer, stopLimitDelta)
    if (mainnet) {
        await createStopLimitPermit(signer, stopLimitDelta)
    }
    //await createStopLimitPermit(signer, stopLimitDelta)
    if (!mainnet) {
        await debugPermit(signer)
    }

}




const debugPermit = async (signer: Signer) => {
    /**
    const permit = {
        signature: '0x30fcc4d3e0603406cf88aca9299a3ec7e8aae2e1c24515c6b83c53817cede0a63f4a3047c106169deecfaca7e455c9349dc9657b624654479aa8531751b073571c',
        permitSingle: {
            details: {
                token: '0x4200000000000000000000000000000000000006',
                amount: '500000000000000',
                expiration: '1735958812',
                nonce: '0'
            },
            spender: '0xF9fFbA0fE174bf7a099B10D1142379322CD1Bf46',
            sigDeadline: '1736045212'
        }
    }
     */
    const permit: Permit2Payload = {
        signature: '0xe463806c46551812fde3cc213a69812d64a9d80157a4622dc7f89eb2941d4951221a145c933175ed3a15fd6cbeb76d33ecad1117978607b91165d843e22a87da1b',
        permitSingle: {
            details: {
                token: '0x4200000000000000000000000000000000000006',
                amount: '500000000000000',
                expiration: '1735957820',
                nonce: '0'
            },
            spender: '0xF9fFbA0fE174bf7a099B10D1142379322CD1Bf46',
            sigDeadline: '1736044220' 
        }
    };

    const encodedData = encodePermit2Payload(permit);
    console.log("Encoded Data:", encodedData);

    const testContract: PermitTest = await DeployContract(new PermitTest__factory(signer), signer, addrs.permit2)
    console.log("Testing deployed")
    await testContract.testDecode(encodedData)

}



const createStopLimitOrder = async (signer: Signer, delta: bigint) => {
    const currentPrice = await master.getExchangeRate(await WETH.getAddress(), await USDC.getAddress())
    await WETH.connect(signer).approve(await stopLimit.getAddress(), wethAmount)
    const tx = await stopLimit.connect(signer).createOrder(
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
    await tx.wait()

    const filter = stopLimit.filters.OrderCreated
    const events = await stopLimit.queryFilter(filter, -1)
    const event = events[0].args
    console.log("Stop Limit Order Created: ", event[0].toString())

}



const createStopLimitPermit = async (signer: Signer, delta: bigint) => {
    const encodedPermit = await encodePermitSingle(
        signer,
        chainId,
        await WETH.getAddress(),
        wethAmount,
        await stopLimit.getAddress(),
        o.permit2
    )
    const currentPrice = await master.getExchangeRate(await WETH.getAddress(), await USDC.getAddress())


    const tx = await stopLimit.connect(signer).createOrder(
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
        true,
        encodedPermit
    )

    await tx.wait()

    const filter = stopLimit.filters.OrderCreated
    const events = await stopLimit.queryFilter(filter, -1)
    const event = events[0].args
    console.log("Stop Limit Order Created: ", event[0].toString())

}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
