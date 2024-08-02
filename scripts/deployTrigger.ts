import hre, { network } from "hardhat";
import { DeployContract } from "../util/deploy";
import { currentBlock, resetCurrent, resetCurrentArb, resetCurrentBase, resetCurrentBsc, resetCurrentOP, resetCurrentOPblock, resetCurrentPoly, resetCurrentZksync } from "../util/block";
import { AutomatedTriggerSwap, AutomatedTriggerSwap__factory, IERC20__factory, IOracleRelay, MasterKeeper, MasterKeeper__factory, OracleRelay__factory, UniswapV3Pool__factory } from "../typechain-types";
import { limitOrderData } from "./limitOrderData";
import { Signer } from "ethers";
import { ceaseImpersonation, impersonateAccount } from "../util/impersonator";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { decodeUpkeepData, generateUniTx, getStrikePrice } from "../util/msc";

const { ethers } = require("hardhat");

//"https://github.com/adrastia-oracle/oku-automation-config/blob/main/worker-config.ts"

const triggerAddr = "0x4f38FA4F676a053ea497F295f855B2dC3580f517"
const wethOracleAddress = "0x064E3A830f905686a718cb100708ff3D90aB5202"
const usdcOracleAddress = "0x8B5AbFbdC5Ec4B88A4e94afBf9f22b81F71a25a9"

const router02 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"
const pool = "0x1fb3cf6e48F1E7B10213E7b6d87D4c073C7Fdb7b"

const wethAddress = "0x4200000000000000000000000000000000000006"
const usdcAddress = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"

const wethFeedAddr = "0x13e3Ee699D1909E989722E753853AE30b17e08c5"
const usdcFeedAddr = "0x16a9FA2FDa030272Ce99B29CF780dFA30361E0f3"

let mainnet = true
let trigger: AutomatedTriggerSwap

//SET THIS FOR TESTING
const testingNetwork = "op"

let masterKeeper: MasterKeeper
async function main() {
  console.log("STARTING")
  let networkName = hre.network.name
  console.log(networkName)

  if (networkName == "hardhat" || networkName == "localhost") {
    networkName = testingNetwork
    mainnet = false
    console.log("Testing on network : ", networkName)

  } else {
    console.log("Deploying for real to: ", networkName)
  }

  if (networkName == "op" && !mainnet) {
    await resetCurrentOP()
    console.log("Testing on OP @", (await currentBlock())?.number)
  }

  const [user] = await ethers.getSigners()


  //await deploy(user)
  //await deployOracles(user)
  //await test(user)
  //await createOrder(user)
  await checkUpkeep(user)


  console.log("DONE")
}

const deploy = async (signer: Signer) => {

  trigger = await DeployContract(new AutomatedTriggerSwap__factory(signer), signer)
  console.log("DEPLOYED: ", await trigger.getAddress())

  if (mainnet) {
    console.log("Verifying...")
    await hre.run("verify:verify", {
      address: await trigger.getAddress()
    })
    console.log("verified")
  }

}

const deployOracles = async (signer: Signer) => {

  const wethOracle: IOracleRelay = await DeployContract(new OracleRelay__factory(signer), signer, wethAddress, wethFeedAddr)
  console.log("DEPLOYED: ", await wethOracle.getAddress())
  console.log("WETH: ", ethers.formatUnits((await wethOracle.currentValue()).toString(), 8))

  const usdcOracle: IOracleRelay = await DeployContract(new OracleRelay__factory(signer), signer, usdcAddress, usdcFeedAddr)
  console.log("DEPLOYED: ", await usdcOracle.getAddress())
  console.log("USDC: ", ethers.formatUnits((await usdcOracle.currentValue()).toString(), 8))


  if (mainnet) {
    console.log("Verifying...")
    await hre.run("verify:verify", {
      address: await wethOracle.getAddress(),
      constructorArguments: [
        wethAddress,
        wethFeedAddr
      ]
    })
    console.log("verified")
  }

}
const test = async (signer: Signer) => {

  trigger = AutomatedTriggerSwap__factory.connect(triggerAddr, signer)

  if (!mainnet) {
    signer = await ethers.getSigner("0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89")

    //testing does not scale tx cost correctly 
    await setBalance(await signer.getAddress(), ethers.parseEther("1"))
    await impersonateAccount(await signer.getAddress())

  }


  //register oracles
  const tokens = [wethAddress, usdcAddress]
  const oracles = [wethOracleAddress, usdcOracleAddress]
  await trigger.connect(signer).registerOracle(tokens, oracles)
  console.log("REGISTERED ORACLES")

  await trigger.connect(signer).setMaxPendingOrders(25)
  console.log("SET MAX PENDING ORDERS")

  await trigger.connect(signer).setMinOrderSize(ethers.parseUnits("0.5", 8))
  console.log("SET MIN ORDER SIZE")

  console.log("CURRENT EXCHANGE RATE: ", ethers.formatUnits((await trigger.getExchangeRate(wethAddress, usdcAddress)), 8))


}

const createOrder = async (signer: Signer) => {
  trigger = AutomatedTriggerSwap__factory.connect(triggerAddr, signer)
  const WETH = IERC20__factory.connect(wethAddress, signer)
  const USDC = IERC20__factory.connect(usdcAddress, signer)
  if (!mainnet) {
    signer = await ethers.getSigner("0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89")

    //testing does not scale tx cost correctly 
    await setBalance(await signer.getAddress(), ethers.parseEther("1"))
    await impersonateAccount(await signer.getAddress())
  }

  const wethAmount = ethers.parseEther("0.0002")
  const strikeDelta = -1

  const rawER = await trigger.getExchangeRate(wethAddress, usdcAddress)
  const strikePrice = await getStrikePrice(rawER, strikeDelta, true)



  await WETH.connect(signer).approve(await trigger.getAddress(), wethAmount)
  await trigger.connect(signer).createOrder(
    strikePrice,
    wethAmount,
    500,
    wethAddress,
    usdcAddress
  )

  const filter = trigger.filters.OrderCreated
  const events = await trigger.queryFilter(filter, -1)
  const event = events[0].args
  console.log("ORDER CREATED: ", Number(event[0]))


}

const checkUpkeep = async (signer: Signer) => {

  //this block requires upkeep
  const UniPool = UniswapV3Pool__factory.connect(pool, signer)

  trigger = AutomatedTriggerSwap__factory.connect(triggerAddr, signer)
  const WETH = IERC20__factory.connect(wethAddress, signer)
  const USDC = IERC20__factory.connect(usdcAddress, signer)
  if (!mainnet) {
    await resetCurrentOPblock(123390401)

    signer = await ethers.getSigner("0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89")

    //testing does not scale tx cost correctly 
    await setBalance(await signer.getAddress(), ethers.parseEther("1"))
    await impersonateAccount(await signer.getAddress())
  }

  const result = await trigger.checkUpkeep("0x")
  const decoded = await decodeUpkeepData(result.performData)

  const encodedTxData = await generateUniTx(
    router02,
    decoded.pendingOrderIdx,
    router02,
    UniPool,
    WETH,
    await USDC.getAddress(),
    await trigger.getAddress(),
    BigInt(decoded.order.amountIn.toString()),
    await trigger.getMinAmountReceived(await WETH.getAddress(), await USDC.getAddress(), BigInt(decoded.order.slippageBips.toString()), BigInt(decoded.order.amountIn.toString()))
  )

  await trigger.performUpkeep(encodedTxData)


}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })



