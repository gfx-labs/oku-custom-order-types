import { Signer } from "ethers"
import { AutomatedTriggerSwap, AutomatedTriggerSwap__factory, IERC20, IERC20__factory, PlaceholderOracle, PlaceholderOracle__factory, UniswapV3Pool, UniswapV3Pool__factory } from "../typechain-types"
import { currentBlock, resetCurrentArb, resetCurrentArbBlock } from "../util/block"
import { ethers } from "hardhat"
import { expect } from "chai"
import { stealMoney } from "../util/money"
import { generateUniTx, getGas } from "../util/msc"

const LimitOrderRegistry = "0x54df9e11c7933a9ca3bd1e540b63da15edae40bf"//arbiscan
const pool = "0xc31e54c7a869b9fcbecc14363cf510d1c41fa443"//WETH/USDC.e pool @ 500
const router02 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"

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
let Bob: Signer
let Andy: Signer

//CL oracles are priced @ 1e8
const initialEthPrice = ethers.parseUnits("3513.49", 8)
const initialUsdcPrice = ethers.parseUnits("0.99999998", 8)


///All tests are performed as if on Arbitrum
///Testing is on the Arb WETH/USDC.e pool @ 500
describe("Automated Trigger Testing on Arbitrum", () => {

    before(async () => {
        console.log("STARTING")
        await resetCurrentArbBlock(233972085)
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


    const strikeDelta = ethers.parseUnits("100", 8)
    const bips = 500

    //setup
    before(async () => {
        //steal money for Bob
        await stealMoney(wethWhale, await Bob.getAddress(), await WETH.getAddress(), wethAmount)
        //set test oracle price
        await wethOracle.setPrice(initialEthPrice)
        await usdcOracle.setPrice(initialUsdcPrice)
    })


    it("Create stop-market order", async () => {
        const currentPrice = await AutoTrigger.getExchangeRate(await WETH.getAddress(), await USDC.getAddress())

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
        await wethOracle.setPrice(initialEthPrice - (strikeDelta))

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
            router02,
            UniPool,
            WETH,
            await USDC.getAddress(),
            await AutoTrigger.getAddress(),
            wethAmount,
            await AutoTrigger.getMinAmountReceived(await WETH.getAddress(), await USDC.getAddress(), bips, wethAmount)
        )
        console.log("Gas to performUpkeep: ", await getGas(await AutoTrigger.performUpkeep(router02, result.pendingOrderIdx, txData.data)))
    })

    it("Verify", async () => {
        //expect user to receive tokens
        const usdcBalance = await USDC.balanceOf(await Bob.getAddress())
        expect(usdcBalance).to.be.gt(0n, "USDC received")

        //pending order removed and length == 0
        expect(await AutoTrigger.PendingOrderIds.length).to.eq(0, "no pending orders left")

        //event
        const filter = AutoTrigger.filters.OrderProcessed
        const events = await AutoTrigger.queryFilter(filter, -1)
        const event = events[0].args
        expect(event.orderId).to.eq(1, "Order Id 1")
        expect(event.success).to.eq(true, "Swap succeeded")

        //no tokens left on contract
        expect(await WETH.balanceOf(await AutoTrigger.getAddress())).to.eq(0n, "0 WETH left on contract")
        expect(await USDC.balanceOf(await AutoTrigger.getAddress())).to.eq(0n, "0 USDC left on contract")

        //check upkeep
        const check = await AutoTrigger.checkUpkeep()
        expect(check.upkeepNeeded).to.eq(false, "no upkeep is needed anymore")
    })
})

describe("Test for failure", () => {
    let npcStrikeDelta = BigInt(ethers.parseUnits("100", 8))
    let npcBips = 100
    let currentPrice: bigint
    const strikeDelta = 1n

    const andyWeth = wethAmount * 20n

    let andyOrder1: number
    const smallSlippage = 1

    before(async () => {
        //reset price
        await wethOracle.setPrice(initialEthPrice)
        currentPrice = await AutoTrigger.getExchangeRate(await WETH.getAddress(), await USDC.getAddress())
        const signers = await ethers.getSigners()

        //create some background orders
        for (let i = signers.length - 10; i < signers.length; i++) {
            const signer = signers[i]

            //fund 
            await stealMoney(wethWhale, await signer.getAddress(), await WETH.getAddress(), wethAmount)

            //increment
            npcStrikeDelta -= BigInt(ethers.parseUnits("5", 8))
            npcBips += 10

            //create order
            await WETH.connect(signer).approve(await AutoTrigger.getAddress(), wethAmount)
            await AutoTrigger.connect(signer).createOrder(
                currentPrice - npcStrikeDelta,
                wethAmount,
                npcBips,
                await WETH.getAddress(),
                await USDC.getAddress()
            )
        }
    })
    beforeEach(async () => {
        //reset price
        await wethOracle.setPrice(initialEthPrice)
        currentPrice = await AutoTrigger.getExchangeRate(await WETH.getAddress(), await USDC.getAddress())

    })

    it("Swap fails due to slippage", async () => {

        //fund and setup andy order
        await stealMoney(wethWhale, await Andy.getAddress(), await WETH.getAddress(), andyWeth)
        await WETH.connect(Andy).approve(await AutoTrigger.getAddress(), andyWeth)
        await AutoTrigger.connect(Andy).createOrder(
            currentPrice + strikeDelta,
            andyWeth,
            smallSlippage,
            await WETH.getAddress(),
            await USDC.getAddress()
        )

        andyOrder1 = Number(await AutoTrigger.orderCount())
        const order = await AutoTrigger.AllOrders(andyOrder1)
        expect(order[5]).to.eq(await Andy.getAddress(), "Andy's order")

        //check upkeep
        const check = await AutoTrigger.checkUpkeep()
        expect(check.upkeepNeeded).to.eq(false, "no upkeep is needed anymore")

        //adjust oracle
        await wethOracle.setPrice(currentPrice + strikeDelta)

        const newCheck = await AutoTrigger.checkUpkeep()
        expect(newCheck.upkeepNeeded).to.eq(true, "upkeep is now needed")

        //pendingOrderIdx is the idx of the pending order id in the pendingOrder array
        const pendingOrderIdx = newCheck.pendingOrderIdx
        const list = await AutoTrigger.getPendingOrders()
        const upkeepOrder = await AutoTrigger.AllOrders(list[Number(pendingOrderIdx)])
        expect(upkeepOrder[0]).to.eq(andyOrder1, "Andy's order")

        //perform
        const txData = await generateUniTx(
            router02,
            UniPool,
            WETH,
            await USDC.getAddress(),
            await AutoTrigger.getAddress(),
            wethAmount,
            await AutoTrigger.getMinAmountReceived(await WETH.getAddress(), await USDC.getAddress(), smallSlippage * 20, wethAmount)
        )
        expect(AutoTrigger.performUpkeep(router02, pendingOrderIdx, txData.data)).to.be.revertedWith("Too Little Received")
    })

    it("Swap fails due to insufficient balance", async () => {
        //adjust oracle
        await wethOracle.setPrice(currentPrice + strikeDelta)

        const newCheck = await AutoTrigger.checkUpkeep()
        expect(newCheck.upkeepNeeded).to.eq(true, "upkeep is now needed")

        const pendingOrderIdx = newCheck.pendingOrderIdx
        let list = await AutoTrigger.getPendingOrders()
        const upkeepOrder = await AutoTrigger.AllOrders(list[Number(pendingOrderIdx)])

        //perform
        const txData = await generateUniTx(
            router02,
            UniPool,
            WETH,
            await USDC.getAddress(),
            await AutoTrigger.getAddress(),
            andyWeth * 5n,//input amount is way too much
            await AutoTrigger.getMinAmountReceived(await WETH.getAddress(), await USDC.getAddress(), smallSlippage, andyWeth)
        )

        const initialAndyWeth = await WETH.balanceOf(await Andy.getAddress())

        //no revert, but process should fail
        await AutoTrigger.performUpkeep(router02, pendingOrderIdx, txData.data)

        const filter = AutoTrigger.filters.OrderProcessed
        const events = await AutoTrigger.queryFilter(filter, -1)
        const event = events[0].args
        expect(event[1]).to.eq(false, "Order Fill Failed")

        //andy's tokenIn should be refunded
        const finalAndyWeth = await WETH.balanceOf(await Andy.getAddress())
        expect(finalAndyWeth - initialAndyWeth).to.eq(andyWeth, "Andy's weth refunded")
        expect(finalAndyWeth - initialAndyWeth).to.eq(upkeepOrder[2], "Andy's weth refund amount correct")

        list = await AutoTrigger.getPendingOrders()
        expect(list.includes(BigInt(andyOrder1))).to.eq(false, "Andy's order removed from pending orders array")

    })
})