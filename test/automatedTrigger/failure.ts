import { BigNumberish, Signer } from "ethers"
import { ethers } from "hardhat"
import { expect } from "chai"
import { stealMoney } from "../../util/money"
import { decodeUpkeepData, generateUniTx } from "../../util/msc"
import { s } from "./scope"


describe("Test for failure", () => {
    let npcStrikeDelta = BigInt(ethers.parseUnits("100", 8))
    let npcBips = 100
    let currentPrice: bigint
    const strikeDelta = 1n

    const andyWeth = s.wethAmount * 20n

    let andyOrder1: number
    const smallSlippage = 1

    let signers: Signer[]

    before(async () => {
        //reset price
        await s.wethOracle.setPrice(s.initialEthPrice)
        currentPrice = await s.AutoTrigger.getExchangeRate(0)
        signers = await ethers.getSigners()

        //create some background orders
        for (let i = signers.length - 10; i < signers.length; i++) {
            const signer = signers[i]

            //fund 
            await stealMoney(s.wethWhale, await signer.getAddress(), await s.WETH.getAddress(), s.wethAmount)

            //increment
            npcStrikeDelta -= BigInt(ethers.parseUnits("5", 8))
            npcBips += 10

            //create order
            await s.WETH.connect(signer).approve(await s.AutoTrigger.getAddress(), s.wethAmount)
            await s.AutoTrigger.connect(signer).createOrder(
                currentPrice - npcStrikeDelta,
                s.wethAmount,
                0,
                npcBips,
                true
            )
        }
    })
    beforeEach(async () => {
        //reset price
        await s.wethOracle.setPrice(s.initialEthPrice)
        currentPrice = await s.AutoTrigger.getExchangeRate(0)

    })
    it("Swap fails due to slippage", async () => {

        //fund and setup s.andy order
        await stealMoney(s.wethWhale, await s.Andy.getAddress(), await s.WETH.getAddress(), andyWeth)
        await s.WETH.connect(s.Andy).approve(await s.AutoTrigger.getAddress(), andyWeth)
        await s.AutoTrigger.connect(s.Andy).createOrder(
            currentPrice + strikeDelta,
            andyWeth,
            0,
            smallSlippage,
            true
        )

        andyOrder1 = Number(await s.AutoTrigger.orderCount())
        const order = await s.AutoTrigger.AllOrders(andyOrder1)
        expect(order[4]).to.eq(await s.Andy.getAddress(), "s.Andy's order")

        //check upkeep
        const check = await s.AutoTrigger.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(false, "no upkeep is needed anymore")

        //adjust oracle
        await s.wethOracle.setPrice(currentPrice + strikeDelta)

        const newCheck = await s.AutoTrigger.checkUpkeep("0x")
        expect(newCheck.upkeepNeeded).to.eq(true, "upkeep is now needed")

        //pendingOrderIdx is the idx of the pending order id in the pendingOrder array
        const decoded = await decodeUpkeepData(newCheck.performData)
        const list = await s.AutoTrigger.getPendingOrders()
        const upkeepOrder = await s.AutoTrigger.AllOrders(list[Number(decoded.pendingOrderIdx)])
        expect(upkeepOrder[0]).to.eq(andyOrder1, "s.Andy's order")

        //perform
        const txData = await generateUniTx(
            s.router02,
            decoded.pendingOrderIdx,
            s.router02,
            s.UniPool,
            s.WETH,
            await s.USDC.getAddress(),
            await s.AutoTrigger.getAddress(),
            s.wethAmount,
            await s.AutoTrigger.getMinAmountReceived(0, true, smallSlippage * 20, s.wethAmount)
        )
        expect(s.AutoTrigger.performUpkeep(txData)).to.be.revertedWith("Too Little Received")
    })

    it("Swap fails due to insufficient balance", async () => {
        //adjust oracle
        await s.wethOracle.setPrice(currentPrice + strikeDelta)

        const newCheck = await s.AutoTrigger.checkUpkeep("0x")
        expect(newCheck.upkeepNeeded).to.eq(true, "upkeep is now needed")

        const decoded = await decodeUpkeepData(newCheck.performData)
        let list = await s.AutoTrigger.getPendingOrders()
        const upkeepOrder = await s.AutoTrigger.AllOrders(list[Number(decoded.pendingOrderIdx)])

        //perform
        const txData = await generateUniTx(
            s.router02,
            decoded.pendingOrderIdx,
            s.router02,
            s.UniPool,
            s.WETH,
            await s.USDC.getAddress(),
            await s.AutoTrigger.getAddress(),
            andyWeth * 5n,//input amount is way too much
            await s.AutoTrigger.getMinAmountReceived(0, true, smallSlippage, andyWeth)
        )


        //no revert, but process should fail
        await s.AutoTrigger.performUpkeep(txData)

        const filter = s.AutoTrigger.filters.OrderProcessed
        const events = await s.AutoTrigger.queryFilter(filter, -1)
        const event = events[0].args
        expect(event[1]).to.eq(false, "Order Fill Failed")

    })

    it("Cancel frontrun - idx out of bounds", async () => {

        //adjust oracle
        await s.wethOracle.setPrice(currentPrice + strikeDelta)
        const newCheck = await s.AutoTrigger.checkUpkeep("0x")
        expect(newCheck.upkeepNeeded).to.eq(true, "upkeep is now needed")
        const decoded = await decodeUpkeepData(newCheck.performData)

        //someone cancels before perform can execute
        const bailer = await ethers.getSigner(await (signers[signers.length - 1]).getAddress())

        //get bailers order
        let list = await s.AutoTrigger.getPendingOrders()
        let bailerOrderId: BigNumberish
        for (let i = 0; i < list.length; i++) {
            const order = await s.AutoTrigger.AllOrders(list[i])
            if (order.recipient == await bailer.getAddress()) {
                bailerOrderId = order.orderId
                break
            }
        }
        expect(bailerOrderId!).to.be.gt(0, "order found")
        await s.AutoTrigger.connect(bailer).cancelOrder(bailerOrderId!)

        //now the pendingOrderIdx should be equal to the length, so the idx is now out of bounds
        list = await s.AutoTrigger.getPendingOrders()
        //expect(list[list.length - 1]).to.eq(decoded.pendingOrderIdx, "idx out of bounds")

        //try to perform upkeep
        const txData = await generateUniTx(
            s.router02,
            decoded.pendingOrderIdx,
            s.router02,
            s.UniPool,
            s.WETH,
            await s.USDC.getAddress(),
            await s.AutoTrigger.getAddress(),
            andyWeth * 5n,//input amount is way too much
            await s.AutoTrigger.getMinAmountReceived(0, true, smallSlippage, andyWeth)
        )

        expect(s.AutoTrigger.performUpkeep(txData)).to.be.reverted

    })

    it("Cancel order frontrun - perform on wrong order", async () => {

        //create a new order
        const orderer: Signer = signers[signers.length - 1]
        await s.WETH.connect(orderer).approve(await s.AutoTrigger.getAddress(), s.wethAmount)
        await s.AutoTrigger.connect(orderer).createOrder(
            currentPrice - strikeDelta,
            s.wethAmount,
            0,
            npcBips,
            true
        )

        //adjust oracle
        await s.wethOracle.setPrice(currentPrice + strikeDelta)
        const newCheck = await s.AutoTrigger.checkUpkeep("0x")
        expect(newCheck.upkeepNeeded).to.eq(true, "upkeep is now needed")
        const decoded = await decodeUpkeepData(newCheck.performData)
        let list = await s.AutoTrigger.getPendingOrders()
        const orderToFill = list[decoded.pendingOrderIdx]

        /**
        console.log("Pending IDX: ", decoded.pendingOrderIdx)
        console.log("List Length: ", list.length)
        console.log("OrderId fil: ", orderToFill)
        console.log(list)
         */

        expect(orderToFill).to.not.eq(list[list.length - 1], "Order to fill is not the final order")

        //someone cancels before perform can execute
        const bailer = await ethers.getSigner(await (signers[signers.length - 5]).getAddress())
        //get bailers order
        let bailerOrderId
        for (let i = 0; i < list.length; i++) {
            const order = await s.AutoTrigger.AllOrders(list[i])
            if (order.recipient == await bailer.getAddress()) {
                bailerOrderId = order.orderId
                break
            }
        }
        console.log("CANCELLING")
        await s.AutoTrigger.connect(bailer).cancelOrder(bailerOrderId!)
        list = await s.AutoTrigger.getPendingOrders()


        //try to perform upkeep
        const txData = await generateUniTx(
            s.router02,
            decoded.pendingOrderIdx,
            s.router02,
            s.UniPool,
            s.WETH,
            await s.USDC.getAddress(),
            await s.AutoTrigger.getAddress(),
            andyWeth * 5n,//input amount is way too much
            await s.AutoTrigger.getMinAmountReceived(0, true, smallSlippage, andyWeth)
        )

        //correct idx preserved via array mutation
        expect(await s.AutoTrigger.performUpkeep(txData)).to.not.be.reverted
    })

    //since s.Andy's order has bad params and will fail, we cancel it
    it("Cancel Order", async () => {

        expect(s.AutoTrigger.connect(s.Bob).cancelOrder(andyOrder1)).to.be.revertedWith("Only Order Owner")

        const initialandyWeth = await s.WETH.balanceOf(await s.Andy.getAddress())
        const initialPendingLength = (await s.AutoTrigger.getPendingOrders()).length

        await s.AutoTrigger.connect(s.Andy).cancelOrder(andyOrder1)

        const finalandyWeth = await s.WETH.balanceOf(await s.Andy.getAddress())
        const finalPendingLength = (await s.AutoTrigger.getPendingOrders()).length

        expect(finalandyWeth - initialandyWeth).to.eq(andyWeth, "s.Andy received refund")
        expect(initialPendingLength - finalPendingLength).to.eq(1, "s.Andy's pending order removed")

    })
})

