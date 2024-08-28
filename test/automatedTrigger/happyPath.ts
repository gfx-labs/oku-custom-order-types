import { AbiCoder, AddressLike, BigNumberish, Signer } from "ethers"
import { AutomatedTriggerSwap, AutomatedTriggerSwap__factory, IERC20, IERC20__factory, PlaceholderOracle, PlaceholderOracle__factory, UniswapV3Pool, UniswapV3Pool__factory } from "../../typechain-types"
import { currentBlock, resetCurrentArb, resetCurrentArbBlock,  } from "../../util/block"
import { ethers } from "hardhat"
import { expect } from "chai"
import { stealMoney } from "../../util/money"
import { decodeUpkeepData, generateUniTx, getGas } from "../../util/msc"
import {s} from "./scope"


///All tests are performed as if on s.Arbitrum
///Testing is on the s.Arb s.WETH/s.USDC.e pool @ 500
describe("Automated Trigger Testing on s.Arbitrum", () => {

    before(async () => {
        console.log("STARTING")
        await resetCurrentArbBlock(235660173)
        console.log("Testing on s.ARB @", (await currentBlock())?.number)

        //connect to signers
        const signers = await ethers.getSigners()
        s.Frank = signers[0]
        s.Andy = signers[1]
        s.Bob = signers[2]
        s.Charles = signers[3]


        s.UniPool = UniswapV3Pool__factory.connect(s.pool, s.Frank)
        s.WETH = IERC20__factory.connect(await s.UniPool.token0(), s.Frank)
        s.USDC = IERC20__factory.connect(await s.UniPool.token1(), s.Frank)
        s.ARB = IERC20__factory.connect("0x912CE59144191C1204E64559FE8253a0e49E6548", s.Frank)
        s.UNI = IERC20__factory.connect("0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0", s.Frank)


    })

    it("Deploy", async () => {
        console.log("DEPLOYING")
        //Deploy
        s.AutoTrigger = await new AutomatedTriggerSwap__factory(s.Frank).deploy()
        await s.AutoTrigger.deploymentTransaction()

        //deploy test oracles
        s.wethOracle = await new PlaceholderOracle__factory(s.Frank).deploy(await s.WETH.getAddress())
        s.usdcOracle = await new PlaceholderOracle__factory(s.Frank).deploy(await s.USDC.getAddress())
        s.uniOracle = await new PlaceholderOracle__factory(s.Frank).deploy(await s.UNI.getAddress())
        s.arbOracle = await new PlaceholderOracle__factory(s.Frank).deploy(await s.ARB.getAddress())



    })

    it("Register", async () => {
        const tokens = [await s.WETH.getAddress(), await s.USDC.getAddress(), await s.UNI.getAddress(), await s.ARB.getAddress()]
        const oracles = [await s.wethOracle.getAddress(), await s.usdcOracle.getAddress(), await s.uniOracle.getAddress(), await s.arbOracle.getAddress()]

        await s.AutoTrigger.connect(s.Frank).registerOracle(tokens, oracles)

        //register all pairs
        const token0s = [await s.WETH.getAddress(), await s.ARB.getAddress()]
        const token1s = [await s.USDC.getAddress(), await s.UNI.getAddress()]
        await s.AutoTrigger.connect(s.Frank).registerPair(token0s, token1s)

    })

    it("Check upkeep", async () => {

        //should be no upkeep needed yet
        const result = await s.AutoTrigger.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(false)
    })
})

describe("Execute Stop-Market Upkeep", () => {
    ///stop-market orders simply do a market swap once the strike price is reached


    const strikeDelta = ethers.parseUnits("100", 8)
    const bips = 500

    //setup
    before(async () => {
        //steal money for s.Bob
        await stealMoney(s.wethWhale, await s.Bob.getAddress(), await s.WETH.getAddress(), s.wethAmount)
        //set test oracle price
        await s.wethOracle.setPrice(s.initialEthPrice)
        await s.usdcOracle.setPrice(s.initialUsdcPrice)
        await s.uniOracle.setPrice(s.initialUniPrice)
        await s.arbOracle.setPrice(s.initialArbPrice)

    })

    it("Verify exchange rate and minAmountReceived logic", async () => {

        const pairList = await s.AutoTrigger.getPairList()


        /**
        console.log("")
        console.log("Decimal in > Decimal out")
        console.log("s.WETH => s.USDC: ", await s.AutoTrigger.getMinAmountReceived(0, true, bips, s.wethAmount))
        console.log("EXPECTED: ", Number(ethers.parseUnits("5597.837", 6)))
        console.log("")
        console.log("Decimal in < Decimal out")
        console.log("s.USDC => s.WETH: ", await s.AutoTrigger.getMinAmountReceived(0, false, bips, s.usdcAmount))
        console.log("EXPECTED: ", Number(ethers.parseUnits("1.47375", 18)))
        console.log("")
        console.log("Decimal in == Decimal out")
        console.log("s.ARB => UNI: ", await s.AutoTrigger.getMinAmountReceived(1, true, bips, s.arbAmount))
        console.log("EXPECTED: ", Number(ethers.parseUnits("661.320584", 18)))
        console.log("")
        //.01400062
         */


    })

    it("Create stop-market order", async () => {
        const currentPrice = await s.AutoTrigger.getExchangeRate(0)

        await s.WETH.connect(s.Bob).approve(await s.AutoTrigger.getAddress(), s.wethAmount)

        //check for max pending orders
        expect(s.AutoTrigger.connect(s.Bob).createOrder(
            currentPrice - strikeDelta,
            s.wethAmount,
            0,
            bips,
            true
        )).to.be.revertedWith("Max Order Count Reached")

        //set max order size
        await s.AutoTrigger.connect(s.Frank).setMaxPendingOrders(50)

        //check for min order size
        //set limit too high for failure - order size should be un USDe8 terms
        await s.AutoTrigger.connect(s.Frank).setMinOrderSize(ethers.parseUnits("50", 18))
        expect(s.AutoTrigger.connect(s.Bob).createOrder(
            currentPrice - strikeDelta,
            s.wethAmount,
            0,
            bips,
            true
        )).to.be.revertedWith("order too small")

        //set appropriate limit
        await s.AutoTrigger.connect(s.Frank).setMinOrderSize(ethers.parseUnits("50", 8))
        await s.AutoTrigger.connect(s.Bob).createOrder(
            currentPrice - strikeDelta,
            s.wethAmount,
            0,
            bips,
            true
        )

        const filter = s.AutoTrigger.filters.OrderCreated
        const events = await s.AutoTrigger.queryFilter(filter, -1)
        const event = events[0].args
        expect(Number(event[0])).to.eq(1, "First order Id")

        //verify pending order exists
        const list = await s.AutoTrigger.getPendingOrders()
        expect(list.length).to.eq(1, "1 pending order")

        //verify our input token was received
        const balance = await s.WETH.balanceOf(await s.AutoTrigger.getAddress())
        expect(balance).to.eq(s.wethAmount, "s.WETH received")



    })


    it("Check upkeep", async () => {

        //should be no upkeep needed yet
        const initial = await s.AutoTrigger.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)

        //reduce price to strike price
        await s.wethOracle.setPrice(s.initialEthPrice - (strikeDelta))

        //check upkeep
        const result = await s.AutoTrigger.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")

    })

    it("Perform Upkeep", async () => {
        //check upkeep
        const result = await s.AutoTrigger.checkUpkeep("0x")

        //get pending order idx
        const decoded = await decodeUpkeepData(result.performData)

        //get perform data
        //we are doing a market swap on univ3 s.weth => s.usdc
        const encodedTxData = await generateUniTx(
            s.router02,
            decoded.pendingOrderIdx,
            s.router02,
            s.UniPool,
            s.WETH,
            await s.USDC.getAddress(),
            await s.AutoTrigger.getAddress(),
            s.wethAmount,
            await s.AutoTrigger.getMinAmountReceived(0, true, bips, s.wethAmount)
        )

        console.log("Gas to performUpkeep: ", await getGas(await s.AutoTrigger.performUpkeep(encodedTxData)))

    })

    it("Verify", async () => {
        //expect user to receive tokens
        const usdcBalance = await s.USDC.balanceOf(await s.Bob.getAddress())
        expect(usdcBalance).to.be.gt(0n, "s.USDC received")

        //pending order removed and length == 0
        expect(await s.AutoTrigger.PendingOrderIds.length).to.eq(0, "no pending orders left")

        //event
        const filter = s.AutoTrigger.filters.OrderProcessed
        const events = await s.AutoTrigger.queryFilter(filter, -1)
        const event = events[0].args
        expect(event.orderId).to.eq(1, "Order Id 1")
        expect(event.success).to.eq(true, "Swap succeeded")

        //no tokens left on contract
        expect(await s.WETH.balanceOf(await s.AutoTrigger.getAddress())).to.eq(0n, "0 s.WETH left on contract")
        expect(await s.USDC.balanceOf(await s.AutoTrigger.getAddress())).to.eq(0n, "0 s.USDC left on contract")

        //check upkeep
        const check = await s.AutoTrigger.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(false, "no upkeep is needed anymore")
    })

})



///s.Charles trades in opposite direction to s.Bob
describe("Inverted order", async () => {
    const strikeDelta = ethers.parseUnits("100", 8)
    const bips = 500
    before(async () => {
        //set test oracle price
        await s.wethOracle.setPrice(s.initialEthPrice)
        await s.usdcOracle.setPrice(s.initialUsdcPrice)

        //fund
        await stealMoney(s.usdcWhale, await s.Charles.getAddress(), await s.USDC.getAddress(), s.usdcAmount)
    })

    it("Create order", async () => {

        const currentPrice = await s.AutoTrigger.getExchangeRate(0)

        await s.USDC.connect(s.Charles).approve(await s.AutoTrigger.getAddress(), s.usdcAmount)
        await s.AutoTrigger.connect(s.Charles).createOrder(
            currentPrice - strikeDelta,
            s.usdcAmount,
            0,
            bips,
            false
        )

        const filter = s.AutoTrigger.filters.OrderCreated
        const events = await s.AutoTrigger.queryFilter(filter, -1)
        const event = events[0].args
        //expect(Number(event[0])).to.eq(2, "Second order Id")

        //verify pending order exists
        const list = await s.AutoTrigger.getPendingOrders()
        expect(list.length).to.eq(1, "1 pending order")

        //verify our input token was received
        const balance = await s.USDC.balanceOf(await s.AutoTrigger.getAddress())
        expect(balance).to.eq(s.usdcAmount, "s.USDC received")

    })

    it("Check upkeep", async () => {

        //should be no upkeep needed yet
        const initial = await s.AutoTrigger.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)

        //reduce price to strike price
        await s.wethOracle.setPrice(s.initialEthPrice - (strikeDelta))

        //check upkeep
        const result = await s.AutoTrigger.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")

    })

    it("Perform Upkeep", async () => {
        //check upkeep
        const result = await s.AutoTrigger.checkUpkeep("0x")

        //get pending order idx
        const decoded = await decodeUpkeepData(result.performData)

        //get perform data
        //we are doing a market swap on univ3 s.weth => s.usdc
        const encodedTxData = await generateUniTx(
            s.router02,
            decoded.pendingOrderIdx,
            s.router02,
            s.UniPool,
            s.USDC,
            await s.WETH.getAddress(),
            await s.AutoTrigger.getAddress(),
            s.usdcAmount,
            await s.AutoTrigger.getMinAmountReceived(0, false, bips, s.usdcAmount)
        )
        console.log("Gas to performUpkeep: ", await getGas(await s.AutoTrigger.performUpkeep(encodedTxData)))

    })

    it("Verify", async () => {

        const wethBalance = await s.WETH.balanceOf(await s.Charles.getAddress())
        expect(wethBalance).to.be.gt(0n, "s.WETH received")

        //pending order removed and length == 0
        expect(await s.AutoTrigger.PendingOrderIds.length).to.eq(0, "no pending orders left")

        //event
        const filter = s.AutoTrigger.filters.OrderProcessed
        const events = await s.AutoTrigger.queryFilter(filter, -1)
        const event = events[0].args
        expect(event.orderId).to.eq(2, "Order Id 2")
        expect(event.success).to.eq(true, "Swap succeeded")

        //no tokens left on contract
        expect(await s.WETH.balanceOf(await s.AutoTrigger.getAddress())).to.eq(0n, "0 s.WETH left on contract")
        expect(await s.USDC.balanceOf(await s.AutoTrigger.getAddress())).to.eq(0n, "0 s.USDC left on contract")

        //check upkeep
        const check = await s.AutoTrigger.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(false, "no upkeep is needed anymore")
    })
})



