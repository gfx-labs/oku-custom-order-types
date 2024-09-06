import { AbiCoder, AddressLike, BigNumberish, Signer } from "ethers"
import { AutomationMaster__factory, IERC20, IERC20__factory, LimitOrder__factory, PlaceholderOracle, PlaceholderOracle__factory, StopLimit__factory, StopLossLimit__factory, UniswapV3Pool, UniswapV3Pool__factory } from "../../typechain-types"
import { currentBlock, resetCurrentArb, resetCurrentArbBlock, } from "../../util/block"
import { ethers } from "hardhat"
import { expect } from "chai"
import { stealMoney } from "../../util/money"
import { decodeUpkeepData, generateUniTx, generateUniTxData, getGas, MasterUpkeepData, OrderType } from "../../util/msc"
import { s, SwapParams } from "./scope"
import { DeployContract } from "../../util/deploy"


///All tests are performed as if on s.Arbitrum
///Testing is on the s.Arb s.WETH/s.USDC.e pool @ 500
describe("Automated Trigger Testing on s.Arbitrum", () => {

    before(async () => {
        await resetCurrentArbBlock(235660173)
        console.log("Testing on ARB @", (await currentBlock())?.number)

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
        //deploy master
        s.Master = await DeployContract(new AutomationMaster__factory(s.Frank), s.Frank)

        //Deploy limit order
        s.LimitOrder = await DeployContract(new LimitOrder__factory(s.Frank), s.Frank, await s.Master.getAddress())

        //deploy stop limit
        s.StopLimit = await DeployContract(
            new StopLimit__factory(s.Frank),
            s.Frank,
            await s.Master.getAddress(),
            await s.LimitOrder.getAddress()
        )

        //deploy stop loss limit
        s.StopLossLimit = await DeployContract(new StopLossLimit__factory(s.Frank), s.Frank, await s.Master.getAddress())

        //deploy test oracles
        s.wethOracle = await new PlaceholderOracle__factory(s.Frank).deploy(await s.WETH.getAddress())
        s.usdcOracle = await new PlaceholderOracle__factory(s.Frank).deploy(await s.USDC.getAddress())
        s.uniOracle = await new PlaceholderOracle__factory(s.Frank).deploy(await s.UNI.getAddress())
        s.arbOracle = await new PlaceholderOracle__factory(s.Frank).deploy(await s.ARB.getAddress())



    })

    it("Register", async () => {

        //register sup keepers
        await s.Master.connect(s.Frank).registerSubKeepers(
            await s.LimitOrder.getAddress(),
            await s.StopLimit.getAddress(),
            await s.StopLossLimit.getAddress()
        )

        //register oracles
        const tokens = [await s.WETH.getAddress(), await s.USDC.getAddress(), await s.UNI.getAddress(), await s.ARB.getAddress()]
        const oracles = [await s.wethOracle.getAddress(), await s.usdcOracle.getAddress(), await s.uniOracle.getAddress(), await s.arbOracle.getAddress()]
        await s.Master.connect(s.Frank).registerOracle(tokens, oracles)

        //set max pending orders
        await s.Master.connect(s.Frank).setMaxPendingOrders(s.maxPendingOrders)

        //set min order size 1000000000n
        await s.Master.connect(s.Frank).setMinOrderSize(s.minOrderSize)

    })

    it("Check upkeep", async () => {

        //should be no upkeep needed yet
        const result = await s.Master.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(false)
    })


})

describe("Execute Limit Order Upkeep", () => {
    ///stop-market orders simply do a market swap once the strike price is reached


    const strikeDelta = ethers.parseUnits("100", 8)
    const bips = 1000

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
        console.log("")
        console.log("Mainly checking that the prices are in the same ballpark and more importantly the scale is correct...")

        /**
        5317945213
        5597837000
         */
        console.log("Decimal in > Decimal out")
        console.log("s.WETH => s.USDC: ", await s.Master.getMinAmountReceived(s.wethAmount, await s.WETH.getAddress(), await s.USDC.getAddress(), bips))
        console.log("EXPECTED        : ", Number(ethers.parseUnits("5597.837", 6)))
        console.log("")

        /**
        1400062500000000000
        1473750000000000000
         */
        console.log("Decimal in < Decimal out")
        console.log("s.USDC => s.WETH: ", await s.Master.getMinAmountReceived(s.usdcAmount, await s.USDC.getAddress(), await s.WETH.getAddress(), bips,))
        console.log("EXPECTED        : ", Number(ethers.parseUnits("1.47375", 18)))
        console.log("")

        /**
        629333739790000000000
        661320584000000000000
         */
        console.log("Decimal in == Decimal out")
        console.log("s.ARB => UNI: ", await s.Master.getMinAmountReceived(s.arbAmount, await s.ARB.getAddress(), await s.UNI.getAddress(), bips,))
        console.log("EXPECTED    : ", Number(ethers.parseUnits("661.320584", 18)))
        console.log("")


    })


    it("Create stop-market order WETH => USDC", async () => {
        const currentPrice = await s.Master.getExchangeRate(await s.WETH.getAddress(), await s.USDC.getAddress())
        await s.WETH.connect(s.Bob).approve(await s.LimitOrder.getAddress(), s.wethAmount)
        await s.LimitOrder.connect(s.Bob).createOrder(
            currentPrice - strikeDelta,
            s.wethAmount,
            await s.WETH.getAddress(),
            await s.USDC.getAddress(),
            await s.Bob.getAddress(),
            bips
        )

        const filter = s.LimitOrder.filters.OrderCreated
        const events = await s.LimitOrder.queryFilter(filter, -1)
        const event = events[0].args
        expect(Number(event[0])).to.eq(1, "First order Id")

        //verify pending order exists
        const list = await s.LimitOrder.getPendingOrders()
        expect(list.length).to.eq(1, "1 pending order")

        //verify our input token was received
        const balance = await s.WETH.balanceOf(await s.LimitOrder.getAddress())
        expect(balance).to.eq(s.wethAmount, "s.WETH received")

    })


    it("Check upkeep", async () => {

        //should be no upkeep needed yet
        let initial = await s.Master.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)
        initial = await s.LimitOrder.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)

        //reduce price to strike price
        await s.wethOracle.setPrice(s.initialEthPrice - (strikeDelta))

        //check upkeep
        let result = await s.Master.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")
        result = await s.LimitOrder.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")

    })

    it("Perform Upkeep", async () => {
        //check upkeep
        const result = await s.Master.checkUpkeep("0x")

        //get returned upkeep data
        const data: MasterUpkeepData = await decodeUpkeepData(result.performData, s.Frank)
        //console.log(OrderType[data.orderType])

        //get minAmountReceived
        const minAmountReceived = await s.Master.getMinAmountReceived(s.wethAmount, await s.WETH.getAddress(), await s.USDC.getAddress(), bips,)

        //generate encoded masterUpkeepData
        const encodedTxData = await generateUniTx(
            s.router02,
            s.UniPool,
            await s.LimitOrder.getAddress(),
            minAmountReceived,
            data
        )

        console.log("Gas to performUpkeep: ", await getGas(await s.Master.performUpkeep(encodedTxData)))
    })

    it("Verify", async () => {
        //expect user to receive tokens
        const usdcBalance = await s.USDC.balanceOf(await s.Bob.getAddress())
        expect(usdcBalance).to.be.gt(0n, "s.USDC received")

        //pending order removed and length == 0
        expect(await s.LimitOrder.PendingOrderIds.length).to.eq(0, "no pending orders left")

        //event
        const filter = s.LimitOrder.filters.OrderProcessed
        const events = await s.LimitOrder.queryFilter(filter, -1)
        const event = events[0].args
        expect(event.orderId).to.eq(1, "Order Id 1")
        expect(event.success).to.eq(true, "Swap succeeded")

        //no tokens left on contract
        expect(await s.WETH.balanceOf(await s.LimitOrder.getAddress())).to.eq(0n, "0 s.WETH left on contract")
        expect(await s.USDC.balanceOf(await s.LimitOrder.getAddress())).to.eq(0n, "0 s.USDC left on contract")

        //check upkeep
        const check = await s.Master.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(false, "no upkeep is needed anymore")
    })

})


/**
 * stop-limit orders create a limit order once strike price is reached
 * stop price is the fill price for stop-limit
 * strike price is the fill price for the limit order once it is created
 */
describe("Execute Stop-Limit Upkeep", () => {


    const stopDelta = ethers.parseUnits("500", 8)//create limit order when price reaches stop
    const strikeDelta = ethers.parseUnits("100", 8)//close limit order when price reaches strike
    const strikeBips = 200
    //setup
    before(async () => {
        //steal money for s.Bob
        await stealMoney(s.wethWhale, await s.Bob.getAddress(), await s.WETH.getAddress(), s.wethAmount)
        //reset test oracle price
        await s.wethOracle.setPrice(s.initialEthPrice)
        await s.usdcOracle.setPrice(s.initialUsdcPrice)
        await s.uniOracle.setPrice(s.initialUniPrice)
        await s.arbOracle.setPrice(s.initialArbPrice)

    })

    it("Create stop-limit order WETH => USDC", async () => {
        const currentPrice = await s.Master.getExchangeRate(await s.WETH.getAddress(), await s.USDC.getAddress())
        await s.WETH.connect(s.Bob).approve(await s.StopLimit.getAddress(), s.wethAmount)
        await s.StopLimit.connect(s.Bob).createOrder(
            currentPrice - stopDelta,
            (currentPrice - stopDelta) + strikeDelta,
            s.wethAmount,
            await s.WETH.getAddress(),
            await s.USDC.getAddress(),
            await s.Bob.getAddress(),
            strikeBips
        )

        const filter = s.StopLimit.filters.OrderCreated
        const events = await s.StopLimit.queryFilter(filter, -1)
        const event = events[0].args
        expect(Number(event[0])).to.eq(1, "First order Id")

        //verify pending order exists
        const list = await s.StopLimit.getPendingOrders()
        expect(list.length).to.eq(1, "1 pending order")

        //verify our input token was received
        const balance = await s.WETH.balanceOf(await s.StopLimit.getAddress())
        expect(balance).to.eq(s.wethAmount, "s.WETH received")

    })

    it("Check upkeep", async () => {

        //should be no upkeep needed yet
        let initial = await s.Master.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)
        initial = await s.StopLimit.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)

        //reduce price to strike price
        await s.wethOracle.setPrice(s.initialEthPrice - (stopDelta))

        //check upkeep
        let result = await s.Master.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")
        result = await s.StopLimit.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")

    })

    it("Perform Upkeep", async () => {
        //check upkeep
        const result = await s.Master.checkUpkeep("0x")

        //no data manipultation is needed, simply pass on to perform
        await s.Master.performUpkeep(result.performData)

    })

    it("Verify", async () => {

        //expect USDC to be removed from stopLimit contract
        let balance = await s.WETH.balanceOf(await s.StopLimit.getAddress())
        expect(balance).to.be.eq(0n, "WETH removed from stopLimit")

        //pending order removed and length == 0
        expect(await s.StopLimit.PendingOrderIds.length).to.eq(0, "no pending orders left")

        //stop-limit order filled event
        const opFilter = s.StopLimit.filters.StopLimitOrderProcessed
        const opEvents = await s.StopLimit.queryFilter(opFilter, -1)
        const opEvent = opEvents[0].args
        expect(opEvent.orderId).to.eq(1, "Order Id 1")


        //no tokens left on contract
        expect(await s.WETH.balanceOf(await s.StopLimit.getAddress())).to.eq(0n, "0 WETH left on contract")
        expect(await s.USDC.balanceOf(await s.StopLimit.getAddress())).to.eq(0n, "0 USDC left on contract")

        //check upkeep
        const check = await s.Master.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(false, "no upkeep is needed anymore")


        const filter = s.LimitOrder.filters.OrderCreated
        const events = await s.LimitOrder.queryFilter(filter, -1)
        const event = events[0].args
        expect(Number(event[0])).to.eq(2, "Second order Id")

        //verify pending order exists
        const list = await s.LimitOrder.getPendingOrders()
        expect(list.length).to.eq(1, "1 pending order")

        //verify our input token was received
        balance = await s.WETH.balanceOf(await s.LimitOrder.getAddress())
        expect(balance).to.eq(s.wethAmount, "s.WETH received")

        //cancel limit order for future tests
        await s.LimitOrder.connect(s.Bob).cancelOrder(2)


    })


})


/**
 * stop-loss-limit orders create a limit order with an added stop loss
 * stop price is the fill price for the stop loss
 * strike price is the fill price for the limit order 
 * the stop and limit fill each have their own slippage
 * There is an option to swap on order create
 * In this example, we swap from USDC to WETH on order create, and swap back to USDC when it fills
 */
describe("Execute Stop-Loss-Limit Upkeep", () => {


    const stopDelta = ethers.parseUnits("500", 8)
    const strikeDelta = ethers.parseUnits("100", 8)
    const strikeBips = 500
    const stopBips = 5000
    const swapInBips = 500
    //setup
    before(async () => {
        //steal money for s.Bob
        await stealMoney(s.usdcWhale, await s.Bob.getAddress(), await s.USDC.getAddress(), s.usdcAmount)
        //reset test oracle price
        await s.wethOracle.setPrice(s.initialEthPrice)
        await s.usdcOracle.setPrice(s.initialUsdcPrice)
        await s.uniOracle.setPrice(s.initialUniPrice)
        await s.arbOracle.setPrice(s.initialArbPrice)

        let initial = await s.Master.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)

    })

    it("Create stop-loss-limit order with swap USDC => WETH => USDC", async () => {
        const currentPrice = await s.Master.getExchangeRate(await s.WETH.getAddress(), await s.USDC.getAddress())
        await s.USDC.connect(s.Bob).approve(await s.StopLossLimit.getAddress(), s.usdcAmount)
        const swapInData = await generateUniTxData(
            s.USDC,
            await s.WETH.getAddress(),
            s.usdcAmount,
            s.router02,
            s.UniPool,
            await s.StopLossLimit.getAddress(),
            await s.Master.getMinAmountReceived(s.usdcAmount, await s.USDC.getAddress(), await s.WETH.getAddress(), swapInBips)
        )


        const swapParams: SwapParams = {
            swapTokenIn: await s.USDC.getAddress(),
            swapAmountIn: s.usdcAmount,
            swapTarget: s.router02,
            swapBips: swapInBips,
            txData: swapInData
        }

        await s.StopLossLimit.connect(s.Bob).createOrderWithSwap(
            swapParams,
            currentPrice + strikeDelta,
            currentPrice - stopDelta,
            await s.WETH.getAddress(),
            await s.USDC.getAddress(),
            await s.Bob.getAddress(),
            strikeBips,
            stopBips
        )

        const filter = s.StopLossLimit.filters.OrderCreated
        const events = await s.StopLossLimit.queryFilter(filter, -1)
        const event = events[0].args
        expect(Number(event[0])).to.eq(1, "First order Id")

        //verify pending order exists
        const list = await s.StopLossLimit.getPendingOrders()
        expect(list.length).to.eq(1, "1 pending order")

        //verify our input token was received
        const balance = await s.WETH.balanceOf(await s.StopLossLimit.getAddress())
        expect(balance).to.be.closeTo(s.wethAmount, 200000000000000000n, "s.WETH received")

    })

    it("Check upkeep", async () => {

        //should be no upkeep needed yet
        let initial = await s.Master.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)
        initial = await s.StopLossLimit.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)

        //increase price to strike price
        await s.wethOracle.setPrice(s.initialEthPrice + (strikeDelta))

        //check upkeep
        let result = await s.Master.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")
        result = await s.StopLossLimit.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")

        //reset price
        await s.wethOracle.setPrice(s.initialEthPrice)

        //upkeep no longer needed
        result = await s.Master.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(false)
        result = await s.StopLossLimit.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(false)

        //decrease price to stop price
        await s.wethOracle.setPrice(s.initialEthPrice - (stopDelta))

        //upkeep needed again
        result = await s.Master.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")
        result = await s.StopLossLimit.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")
    })

    it("Perform Upkeep - stop loss", async () => {
        //check upkeep
        const result = await s.Master.checkUpkeep("0x")

        //get returned upkeep data
        const data: MasterUpkeepData = await decodeUpkeepData(result.performData, s.Frank)

        //get minAmountReceived
        const minAmountReceived = await s.Master.getMinAmountReceived(data.amountIn, await s.WETH.getAddress(), await s.USDC.getAddress(), stopBips)

        //generate encoded masterUpkeepData
        const encodedTxData = await generateUniTx(
            s.router02,
            s.UniPool,
            await s.StopLossLimit.getAddress(),
            minAmountReceived,
            data
        )

        console.log("Gas to performUpkeep: ", await getGas(await s.Master.performUpkeep(encodedTxData)))

    })
    it("Verify", async () => {
        //expect user to receive tokens
        const usdcBalance = await s.USDC.balanceOf(await s.Bob.getAddress())
        expect(usdcBalance).to.be.gt(0n, "s.USDC received")

        //pending order removed and length == 0
        expect(await s.StopLossLimit.PendingOrderIds.length).to.eq(0, "no pending orders left")

        //event
        const filter = s.StopLossLimit.filters.OrderProcessed
        const events = await s.StopLossLimit.queryFilter(filter, -1)
        const event = events[0].args
        expect(event.orderId).to.eq(1, "Order Id 1")
        expect(event.success).to.eq(true, "Swap succeeded")

        //no tokens left on contract
        expect(await s.WETH.balanceOf(await s.StopLossLimit.getAddress())).to.eq(0n, "0 s.WETH left on contract")
        expect(await s.USDC.balanceOf(await s.StopLossLimit.getAddress())).to.eq(0n, "0 s.USDC left on contract")

        //check upkeep
        const check = await s.Master.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(false, "no upkeep is needed anymore")
    })
})
