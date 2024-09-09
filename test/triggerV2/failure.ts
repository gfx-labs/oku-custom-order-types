import { AutomationMaster__factory, IERC20__factory, LimitOrder__factory, PlaceholderOracle__factory, StopLimit__factory, StopLossLimit__factory, UniswapV3Pool__factory } from "../../typechain-types"
import { currentBlock, resetCurrentArbBlock } from "../../util/block"
import { expect } from "chai"
import { stealMoney } from "../../util/money"
import { decodeUpkeepData, generateUniTx, generateUniTxData, getGas, MasterUpkeepData } from "../../util/msc"
import { s, SwapParams } from "./scope"
import { DeployContract } from "../../util/deploy"
import { ethers } from "hardhat"


///All tests are performed as if on Arbitrum
///Testing is on the Arb WETH/USDC.e pool @ 500
describe("Test for failure - LIMIT", () => {

    let npcStrikeDelta = BigInt(ethers.parseUnits("100", 8))
    let npcBips = 500
    let currentPrice: bigint

    let andyOrder: number
    const andyStrikeDelta = BigInt(ethers.parseUnits("75", 8))
    const smallSlippage = 0
    const andyBips = 500

    const veryLargeWethAmount = s.andyWeth * 5n


    before(async () => {
        //reset price
        await s.wethOracle.setPrice(s.initialEthPrice)
        currentPrice = await s.Master.getExchangeRate(await s.WETH.getAddress(), s.USDC.getAddress())

        //fund Andy
        await stealMoney(s.wethWhale, await s.Andy.getAddress(), await s.WETH.getAddress(), s.andyWeth)


        //create some background orders
        for (let i = s.signers.length - 10; i < s.signers.length; i++) {
            const signer = s.signers[i]

            //fund 
            await stealMoney(s.wethWhale, await signer.getAddress(), await s.WETH.getAddress(), s.wethAmount)

            //increment
            npcStrikeDelta -= BigInt(ethers.parseUnits("5", 8))
            npcBips += 10

            //create order
            await s.WETH.connect(signer).approve(await s.LimitOrder.getAddress(), s.wethAmount)
            await s.LimitOrder.connect(signer).createOrder(
                currentPrice - npcStrikeDelta,
                s.wethAmount,
                await s.WETH.getAddress(),
                await s.USDC.getAddress(),
                await signer.getAddress(),
                npcBips
            )
        }

    })

    beforeEach(async () => {
        //reset price
        await s.wethOracle.setPrice(s.initialEthPrice)
        currentPrice = await s.Master.getExchangeRate(await s.WETH.getAddress(), s.USDC.getAddress())

    })

    it("Swap fails due to slippage", async () => {
        await s.WETH.connect(s.Andy).approve(await s.LimitOrder.getAddress(), s.andyWeth)
        await s.LimitOrder.connect(s.Andy).createOrder(
            currentPrice + andyStrikeDelta,
            s.wethAmount,
            await s.WETH.getAddress(),
            await s.USDC.getAddress(),
            await s.Andy.getAddress(),
            smallSlippage
        )

        andyOrder = Number(await s.LimitOrder.limitOrderCount())
        const order = await s.LimitOrder.limitOrders(andyOrder)
        expect(order.recipient).to.eq(await s.Andy.getAddress(), "Andy's order")

        const filter = s.LimitOrder.filters.OrderCreated
        const events = await s.LimitOrder.queryFilter(filter, -1)
        const event = events[0].args
        expect(Number(event.orderId)).to.eq(andyOrder, "First order Id")

        //check upkeep
        let check = await s.Master.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(false, "no upkeep is needed yet")

        //adjust oracle
        await s.wethOracle.setPrice(currentPrice + andyStrikeDelta)

        //check upkeep
        check = await s.Master.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(true, "upkeep needed")

        //confirm pending order to be executed is Andy's order
        const data: MasterUpkeepData = await decodeUpkeepData(check.performData, s.Andy)
        const pendingOrders = await s.LimitOrder.getPendingOrders()
        expect(pendingOrders[Number(data.pendingOrderIdx)]).to.eq(andyOrder, "Andy's order is being filled")

        //try to fill, fail - slippage too low
        let minAmountReceived = await s.Master.getMinAmountReceived(data.amountIn, data.tokenIn, data.tokenOut, 500)//bips too high

        let encodedTxData = await generateUniTx(
            s.router02,
            s.UniPool,
            await s.LimitOrder.getAddress(),
            minAmountReceived,
            data
        )

        expect(s.Master.performUpkeep(encodedTxData)).to.be.revertedWith("Too Little Received")

        //try to cancel order that isn't yours
        expect(s.LimitOrder.connect(s.Bob).cancelOrder(andyOrder)).to.be.revertedWith("Only Order Owner")

        minAmountReceived = await s.Master.getMinAmountReceived(data.amountIn, data.tokenIn, data.tokenOut, data.bips)//actual bips are 0% slippage

        encodedTxData = await generateUniTx(
            s.router02,
            s.UniPool,
            await s.LimitOrder.getAddress(),
            minAmountReceived,
            data
        )

        //tx succeeds if we try to fill with 0% slippage, but swap fails
        expect(await s.Master.performUpkeep(encodedTxData)).to.not.be.reverted

        const orderProcessedFilter = s.LimitOrder.filters.OrderProcessed
        const opEvents = await s.LimitOrder.queryFilter(orderProcessedFilter, -1)
        const opEvent = opEvents[0].args
        expect(Number(opEvent.orderId)).to.eq(andyOrder, "Andy's order processed")
        expect(opEvent.success).to.eq(false, "swap failed")


        //cancel order for future tests
        await s.LimitOrder.connect(s.Andy).cancelOrder(andyOrder)

    })

    it("Order creation fails due to insufficient balance", async () => {
        await s.WETH.connect(s.Andy).approve(await s.LimitOrder.getAddress(), veryLargeWethAmount)
        expect(s.LimitOrder.connect(s.Andy).createOrder(
            currentPrice + andyStrikeDelta,
            veryLargeWethAmount,
            await s.WETH.getAddress(),
            await s.USDC.getAddress(),
            await s.Andy.getAddress(),
            smallSlippage
        )).to.be.revertedWith("ERC20: transfer amount exceeds balance")

    })

    /**
     * What if there is a bunch of weth on the contract due to other pending orders
     * what prevents us from sending a uni tx to swap all of this for some amount of USDC and send it to ourselves?
     */
    it("Spend pending balances", async () => {

        //create order
        await s.WETH.connect(s.Andy).approve(await s.LimitOrder.getAddress(), s.wethAmount)
        await s.LimitOrder.connect(s.Andy).createOrder(
            currentPrice + andyStrikeDelta,
            s.wethAmount,
            await s.WETH.getAddress(),
            await s.USDC.getAddress(),
            await s.Andy.getAddress(),
            andyBips
        )

        //adjust oracle
        await s.wethOracle.setPrice(currentPrice + andyStrikeDelta)

        //check upkeep
        const check = await s.Master.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(true, "upkeep needed")


        //confirm pending order to be executed is Andy's order
        andyOrder = Number(await s.LimitOrder.limitOrderCount())
        const order = await s.LimitOrder.limitOrders(andyOrder)
        expect(order.recipient).to.eq(await s.Andy.getAddress(), "Andy's order")
        const data: MasterUpkeepData = await decodeUpkeepData(check.performData, s.Andy)
        const pendingOrders = await s.LimitOrder.getPendingOrders()
        expect(pendingOrders[Number(data.pendingOrderIdx)]).to.eq(andyOrder, "Andy's order is being filled")

        //now that we confirmed we are filling Andy's order,

        //how much weth is on the contract, relative to how much we are supposed to be allowed to send (andy's order.amountIn)?
        const totalWeths = await s.WETH.balanceOf(await s.LimitOrder.getAddress())
        const amountIn = data.amountIn

        console.log("TOTAL: ", ethers.formatEther(totalWeths))
        console.log("ANDYS: ", ethers.formatEther(amountIn))

        data.amountIn += ethers.parseEther("0.5")//increase the amount we pass in to encoded data

        console.log("FinalAmountIn: ", ethers.formatEther(data.amountIn))

        //try to fill
        let minAmountReceived = await s.Master.getMinAmountReceived(data.amountIn, data.tokenIn, data.tokenOut, data.bips)

        let encodedTxData = await generateUniTx(
            s.router02,
            s.UniPool,
            await s.LimitOrder.getAddress(),
            minAmountReceived,
            data
        )

        await s.Master.performUpkeep(encodedTxData)

        //weth empty?
        let balance = await s.WETH.balanceOf(await s.LimitOrder.getAddress())
        console.log("REMAIN: ", ethers.formatEther(balance))//BIG TODO this is now less than it should be, meaning that Andy used someone else's funds by encoding data dishonestly 


    })

})

