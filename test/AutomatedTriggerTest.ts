import { AddressLike, Signer } from "ethers"
import { AutomatedTriggerSwap, AutomatedTriggerSwap__factory, IERC20, IERC20__factory, IOracleRelay, MasterKeeper, MasterKeeperV2, MasterKeeperV2__factory, PlaceholderOracle, PlaceholderOracle__factory, UniV3TickTwapOracle__factory, UniswapV3Pool, UniswapV3Pool__factory } from "../typechain-types"
import { currentBlock, resetCurrentArb } from "../util/block"
import { ethers } from "hardhat"
import { expect } from "chai"
import { stealMoney } from "../util/money"
import { ExactInputSingleParams, generateUniTx, getEvent } from "../util/msc"

const LimitOrderRegistry = "0x54df9e11c7933a9ca3bd1e540b63da15edae40bf"//arbiscan
const pool = "0xc31e54c7a869b9fcbecc14363cf510d1c41fa443"//WETH/USDC.e pool @ 500
const router02 = "0xE592427A0AEce92De3Edee1F18E0157C05861564"


let AutoTrigger: AutomatedTriggerSwap
let wethOracle: PlaceholderOracle
let usdcOracle: PlaceholderOracle

let UniPool: UniswapV3Pool
let WETH: IERC20 //weth token0 0x82af49447d8a07e3bd95bd0d56f35241523fbab1
let USDC: IERC20 //USDC.e token1 0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8

const wethWhale = "0xE4f718a0b06D91cF6ff436d4445315ABDF99247b"
const usdcWhale = "0x25681Ab599B4E2CEea31F8B498052c53FC2D74db"
const wethAmount = ethers.parseEther("1.65")
const usdcAmount = ethers.parseUnits("5000", 6)

let Frank: Signer
let Bob: Signer //stop-market
let Andy: Signer

type order = {
    orderId: BigInt,
    strikePrice: BigInt,
    amountIn: BigInt,
    slippageBips: BigInt,
    tokenIn: AddressLike,
    tokenOut: AddressLike,
    recipient: AddressLike,
    direction: Boolean
}



///All tests are performed as if on Arbitrum
///Testing is on the Arb WETH/USDC.e pool @ 500
describe("Automated Trigger Testing on Arbitrum", () => {

    before(async () => {
        console.log("STARTING")
        await resetCurrentArb()
        console.log("Testing on ARB @", (await currentBlock())?.number)

        //connect to signers
        const signers = await ethers.getSigners()
        Frank = signers[0]
        Bob = signers[1]
        Andy = signers[2]

        UniPool = UniswapV3Pool__factory.connect(pool, Frank)
        WETH = IERC20__factory.connect(await UniPool.token0(), Frank)
        USDC = IERC20__factory.connect(await UniPool.token1(), Frank)

    })

    it("Deploy", async () => {
        //Deploy keeper
        AutoTrigger = await new AutomatedTriggerSwap__factory(Frank).deploy(LimitOrderRegistry)
        await AutoTrigger.deploymentTransaction()

        //deploy test oracles
        wethOracle = await new PlaceholderOracle__factory(Frank).deploy(await WETH.getAddress())
        usdcOracle = await new PlaceholderOracle__factory(Frank).deploy(await USDC.getAddress())

    })

    it("Register", async () => {
        const tokens = [await WETH.getAddress(), await USDC.getAddress()]
        const oracles = [await wethOracle.getAddress(), await usdcOracle.getAddress()]

        await AutoTrigger.connect(Frank).registerOracle(tokens, oracles)
    })

    it("Check upkeep", async () => {

        //should be no upkeep needed yet
        const result = await AutoTrigger.checkUpkeep()
        expect(result.upkeepNeeded).to.eq(false)
        expect(result.pendingOrderIdx).to.eq(0n)
    })
})

describe("Execute Stop-Market Upkeep", () => {
    ///stop-market orders simply do a market swap once the strike price is reached

    const initialEthPrice = ethers.parseUnits("3000", 8)
    const strikeDelta = ethers.parseUnits("100", 8)
    const bips = 5000

    //setup
    before(async () => {
        //steal money for Bob
        await stealMoney(wethWhale, await Bob.getAddress(), await WETH.getAddress(), wethAmount)

        //set test oracle price
        await wethOracle.setPrice(initialEthPrice)//CL oracles are priced @ 1e8
        await usdcOracle.setPrice(ethers.parseUnits("1.001", 8))//CL oracles are priced @ 1e8

    })


    it("Create stop-market order", async () => {
        const currentPrice = await wethOracle.currentValue()


        await WETH.connect(Bob).approve(await AutoTrigger.getAddress(), wethAmount)

        await AutoTrigger.connect(Bob).createOrder(
            currentPrice - strikeDelta,
            wethAmount,
            bips,
            await WETH.getAddress(),
            await USDC.getAddress()
        )

        const filter = AutoTrigger.filters.OrderCreated
        const events = await AutoTrigger.queryFilter(filter, -1)
        const event = events[0].args
        expect(Number(event[0])).to.eq(1, "First order Id")

        //verify pending order exists
        const list = await AutoTrigger.getPendingOrders()
        expect(list.length).to.eq(1, "1 pending order")

        //verify our input token was received
        const balance = await WETH.balanceOf(await AutoTrigger.getAddress())
        expect(balance).to.eq(wethAmount, "WETH received")



    })

    it("Check upkeep", async () => {

        //should be no upkeep needed yet
        const initial = await AutoTrigger.checkUpkeep()
        expect(initial.upkeepNeeded).to.eq(false)

        //reduce price to strike price
        await wethOracle.setPrice(initialEthPrice - strikeDelta)

        //check upkeep
        const result = await AutoTrigger.checkUpkeep()
        expect(result[0]).to.eq(true, "Upkeep is now needed")

    })

    it("Perform Upkeep", async () => {

        //check upkeep
        const result = await AutoTrigger.checkUpkeep()
        expect(result[0]).to.eq(true, "Upkeep is now needed")
        //get perform data
        //we are doing a market swap on univ3 weth => usdc


        const txData = await generateUniTx(
            await AutoTrigger.getAddress(),
            router02,
            UniPool,
            WETH,
            await USDC.getAddress(),
            Bob,
            wethAmount,
            await AutoTrigger.getMinAmountReceived(await WETH.getAddress(), await USDC.getAddress(), bips)
        )

        console.log("SENDING IT")
        await AutoTrigger.performUpkeep(pool, result.pendingOrderIdx, txData.data)


    })
    /**
      it("Verify", async () => {
  
      })
       */
})

describe("Execute Stop-Limit and Stop-Close Upkeep", () => {


    //setup
    before(async () => {


    })

    it("Register the pool", async () => {

    })

    it("Check, perform, and verify upkeep", async () => {

    })
})