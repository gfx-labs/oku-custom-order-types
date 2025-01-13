import hre, { network } from "hardhat";
import { currentBlock, resetCurrentArb, resetCurrentBase, resetCurrentOP } from "../util/block";
import { AutomationMaster, AutomationMaster__factory, Bracket, Bracket__factory, ERC20__factory, IERC20, IERC20__factory, IOracleRelay, IOracleRelay__factory, IPermit2__factory, IUniswapV3Factory, IUniswapV3Factory__factory, oracle, OracleLess, OracleLess__factory, PermitTest, PermitTest__factory, StopLimit, StopLimit__factory, UniswapV3Pool__factory } from "../typechain-types";
import { AbiCoder, formatUnits, getBytes, Signer } from "ethers";
import { impersonateAccount } from "../util/impersonator";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { decodeUpkeepData, encodePermit2Payload, encodePermitSingle, generateUniTx, generateUniTxData, MasterUpkeepData, MasterUpkeepTuple, Permit2Payload, permitSingle } from "../util/msc";
import { a, b, o } from "../util/addresser";
import { s, SwapParams } from "../test/triggerV2/scope";
import { ChainAddresses, OptimisimAddresses } from "../util/deploymentAddresses";
import { DeployContract } from "../util/deploy";
import { bigint } from "hardhat/internal/core/params/argumentTypes";
const { ethers } = require("hardhat");
const abi = new AbiCoder()

//SET THIS FOR TESTING
const testingNetwork = "op"
const userAddr = "0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89"
const wethAmount = ethers.parseEther("0.0005")
const stopLimitDelta = ethers.parseUnits("1", 8)
const strikeDelta = ethers.parseUnits("5", 8)
const stopDelta = ethers.parseUnits("5", 8)
const oracleLessBips = 300n//percentage bips

let master: AutomationMaster
let stopLimit: StopLimit
let bracket: Bracket
let oracleLess: OracleLess
let mainnet = true
let permitAddr: string
let chainId = 42161
let addrs: ChainAddresses
let factory: IUniswapV3Factory

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
        }

        addrs = new OptimisimAddresses()
    }

    master = AutomationMaster__factory.connect(addrs.coreDeployments.master, signer)
    stopLimit = StopLimit__factory.connect(addrs.coreDeployments.stopLimit, signer)
    bracket = Bracket__factory.connect(addrs.coreDeployments.bracket, signer)
    oracleLess = OracleLess__factory.connect(addrs.coreDeployments.oracleLess, signer)
    WETH = IERC20__factory.connect((addrs.allTokens.find(token => token.symbol === "WETH"))!.token, signer)
    USDC = IERC20__factory.connect((addrs.allTokens.find(token => token.symbol === "USDC"))!.token, signer)

    factory = IUniswapV3Factory__factory.connect("0x1F98431c8aD98523631AE4a59f267346ea31F984", signer)
    
    await fillOracleLessOrder(signer)
}

type olOrder = {
    orderId: bigint,
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint,
    minAmountOut: bigint,
    recipient: string,
    feeBips: number
}
const fillOracleLessOrder = async (signer: Signer) => {

    //get orders
    const orders = await oracleLess.getPendingOrders()
    //console.log("Orders: ", orders)

    for (let i = 0; i < orders.length; i++) {
        const order = orders[i]

        const currentMinAmount = await master.getMinAmountReceived(order.amountIn, order.tokenIn, order.tokenOut, 0)
        console.log("")
        console.log("Current: ", currentMinAmount)
        console.log("Targett: ", orders[i].minAmountOut)

        if(orders[i].minAmountOut <= currentMinAmount){
            console.log("FILLING ORDER: ", order.orderId)
            const tokenIn = ERC20__factory.connect(order.tokenIn, signer)
            const tokenOut = ERC20__factory.connect(order.tokenOut, signer)
            let pool = UniswapV3Pool__factory.connect(await factory.getPool(order.tokenIn, order.tokenOut, 500), signer)
            console.log("Got pool: ", await pool.getAddress())
            //verify pool is solvant, if not, pick a different fee tier
            //get oracle for tokenIn, and use this to get USD value of whichever token this is in the pool
            const oracleIn: IOracleRelay = IOracleRelay__factory.connect(addrs.allTokens.find(token => token.token.toUpperCase() == order.tokenIn.toUpperCase())!.relay, signer)
            const currentPrice = await oracleIn.currentValue()
            const balanceTokenIn = await tokenIn.balanceOf(await pool.getAddress())
            const valueTokenIn = (balanceTokenIn * currentPrice) / 100000000n
            const adjustedValue = ethers.formatUnits(valueTokenIn, await tokenIn.decimals())
            if(adjustedValue < 1000){
                console.log("Insufficient liquidity in pool, moving to 3k fee tier")
                pool = UniswapV3Pool__factory.connect(await factory.getPool(order.tokenIn, order.tokenOut, 3000), signer)
                console.log("Got 3k pool: ", await pool.getAddress())
            }
            const txData = await generateUniTxData(
                tokenIn,
                order.tokenOut,
                order.amountIn,
                s.router02,
                pool,
                await oracleLess.getAddress(),
                order.minAmountOut
            )
            await oracleLess.fillOrder(i, order.orderId, s.router02, txData)
            console.log(`Filled ${order.orderId} ${await tokenIn.symbol()} => ${await tokenOut.symbol()}`)
            //need to end loop, as the array idxs will be messed up if trying to fill multiple orders in one loop
            break
        }
    }
}







main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
