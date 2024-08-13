import { AbiCoder, AddressLike, BigNumberish, Signer } from "ethers"
import { AutomatedTriggerSwap, AutomatedTriggerSwap__factory, IERC20, IERC20__factory, PlaceholderOracle, PlaceholderOracle__factory, UniswapV3Pool, UniswapV3Pool__factory } from "../typechain-types"
import { currentBlock, resetCurrentArb, resetCurrentArbBlock } from "../util/block"
import { ethers } from "hardhat"
import { expect } from "chai"
import { stealMoney } from "../util/money"
import { decodeUpkeepData, generateUniTx, getGas } from "../util/msc"

const abi = new AbiCoder()

type Order = {
    orderId: BigInt,
    strikePrice: BigInt,
    amountIn: BigInt,
    pairId: BigInt,
    recipient: AddressLike,
    slippageBips: BigInt,
    zeroForOne: Boolean,
    direction: Boolean
}

const LimitOrderRegistry = "0x54df9e11c7933a9ca3bd1e540b63da15edae40bf"//arbiscan
const pool = "0xc31e54c7a869b9fcbecc14363cf510d1c41fa443"//WETH/USDC.e pool @ 500
const router02 = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45"

let AutoTrigger: AutomatedTriggerSwap
let wethOracle: PlaceholderOracle
let usdcOracle: PlaceholderOracle
let uniOracle: PlaceholderOracle
let arbOracle: PlaceholderOracle

let UniPool: UniswapV3Pool
let WETH: IERC20 //weth token0 0x82af49447d8a07e3bd95bd0d56f35241523fbab1
let USDC: IERC20 //USDC.e token1 0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8
let ARB: IERC20 //0x912CE59144191C1204E64559FE8253a0e49E6548
let UNI: IERC20 //0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0

const wethWhale = "0xE4f718a0b06D91cF6ff436d4445315ABDF99247b"
const usdcWhale = "0x25681Ab599B4E2CEea31F8B498052c53FC2D74db"
const wethAmount = ethers.parseEther("1.65")
const usdcAmount = ethers.parseUnits("5000", 6)
const uniAmount = ethers.parseEther("665")
const arbAmount = ethers.parseEther("6580")

let Frank: Signer
let Andy: Signer
let Bob: Signer
let Charles: Signer

//CL oracles are priced @ 1e8
const initialEthPrice = ethers.parseUnits("3391.95", 8)
const initialUsdcPrice = ethers.parseUnits("0.9998", 8)
const initialUniPrice = ethers.parseUnits("7.53", 8)
const initialArbPrice = ethers.parseUnits("0.7581", 8)


///All tests are performed as if on Arbitrum
///Testing is on the Arb WETH/USDC.e pool @ 500
describe("Automated Trigger Testing on Arbitrum", () => {

    before(async () => {
        console.log("STARTING")
        await resetCurrentArbBlock(235660173)
        console.log("Testing on ARB @", (await currentBlock())?.number)

        //connect to signers
        const signers = await ethers.getSigners()
        Frank = signers[0]
        Andy = signers[1]
        Bob = signers[2]
        Charles = signers[3]


        UniPool = UniswapV3Pool__factory.connect(pool, Frank)
        WETH = IERC20__factory.connect(await UniPool.token0(), Frank)
        USDC = IERC20__factory.connect(await UniPool.token1(), Frank)
        ARB = IERC20__factory.connect("0x912CE59144191C1204E64559FE8253a0e49E6548", Frank)
        UNI = IERC20__factory.connect("0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0", Frank)


    })

    it("Deploy", async () => {
        console.log("DEPLOYING")
        //Deploy keeper
        AutoTrigger = await new AutomatedTriggerSwap__factory(Frank).deploy()
        await AutoTrigger.deploymentTransaction()

        //deploy test oracles
        wethOracle = await new PlaceholderOracle__factory(Frank).deploy(await WETH.getAddress())
        usdcOracle = await new PlaceholderOracle__factory(Frank).deploy(await USDC.getAddress())
        uniOracle = await new PlaceholderOracle__factory(Frank).deploy(await UNI.getAddress())
        arbOracle = await new PlaceholderOracle__factory(Frank).deploy(await ARB.getAddress())



    })

    it("Register", async () => {
        const tokens = [await WETH.getAddress(), await USDC.getAddress(), await UNI.getAddress(), await ARB.getAddress()]
        const oracles = [await wethOracle.getAddress(), await usdcOracle.getAddress(), await uniOracle.getAddress(), await arbOracle.getAddress()]

        await AutoTrigger.connect(Frank).registerOracle(tokens, oracles)

        //register all pairs
        const token0s = [await WETH.getAddress(), await ARB.getAddress()]
        const token1s = [await USDC.getAddress(), await UNI.getAddress()]
        await AutoTrigger.connect(Frank).registerPair(token0s, token1s)

    })

    it("Check upkeep", async () => {

        //should be no upkeep needed yet
        const result = await AutoTrigger.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(false)
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
        await uniOracle.setPrice(initialUniPrice)
        await arbOracle.setPrice(initialArbPrice)

    })

    it("Verify exchange rate and minAmountReceived logic", async () => {

        const pairList = await AutoTrigger.getPairList()


        /**
        console.log("")
        console.log("Decimal in > Decimal out")
        console.log("WETH => USDC: ", await AutoTrigger.getMinAmountReceived(0, true, bips, wethAmount))
        console.log("EXPECTED: ", Number(ethers.parseUnits("5597.837", 6)))
        console.log("")
        console.log("Decimal in < Decimal out")
        console.log("USDC => WETH: ", await AutoTrigger.getMinAmountReceived(0, false, bips, usdcAmount))
        console.log("EXPECTED: ", Number(ethers.parseUnits("1.47375", 18)))
        console.log("")
        console.log("Decimal in == Decimal out")
        console.log("ARB => UNI: ", await AutoTrigger.getMinAmountReceived(1, true, bips, arbAmount))
        console.log("EXPECTED: ", Number(ethers.parseUnits("661.320584", 18)))
        console.log("")
        //.01400062
         */


    })

    it("Create stop-market order", async () => {
        const currentPrice = await AutoTrigger.getExchangeRate(0)

        await WETH.connect(Bob).approve(await AutoTrigger.getAddress(), wethAmount)

        //check for max pending orders
        expect(AutoTrigger.connect(Bob).createOrder(
            currentPrice - strikeDelta,
            wethAmount,
            0,
            bips,
            true
        )).to.be.revertedWith("Max Order Count Reached")

        //set max order size
        await AutoTrigger.connect(Frank).setMaxPendingOrders(50)

        //check for min order size
        //set limit too high for failure - order size should be un USDe8 terms
        await AutoTrigger.connect(Frank).setMinOrderSize(ethers.parseUnits("50", 18))
        expect(AutoTrigger.connect(Bob).createOrder(
            currentPrice - strikeDelta,
            wethAmount,
            0,
            bips,
            true
        )).to.be.revertedWith("order too small")

        //set appropriate limit
        await AutoTrigger.connect(Frank).setMinOrderSize(ethers.parseUnits("50", 8))
        await AutoTrigger.connect(Bob).createOrder(
            currentPrice - strikeDelta,
            wethAmount,
            0,
            bips,
            true
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
        const initial = await AutoTrigger.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)

        //reduce price to strike price
        await wethOracle.setPrice(initialEthPrice - (strikeDelta))

        //check upkeep
        const result = await AutoTrigger.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")

    })

    it("Perform Upkeep", async () => {
        //check upkeep
        const result = await AutoTrigger.checkUpkeep("0x")

        //get pending order idx
        const decoded = await decodeUpkeepData(result.performData)

        //get perform data
        //we are doing a market swap on univ3 weth => usdc
        const encodedTxData = await generateUniTx(
            router02,
            decoded.pendingOrderIdx,
            router02,
            UniPool,
            WETH,
            await USDC.getAddress(),
            await AutoTrigger.getAddress(),
            wethAmount,
            await AutoTrigger.getMinAmountReceived(0, true, bips, wethAmount)
        )

        console.log("Gas to performUpkeep: ", await getGas(await AutoTrigger.performUpkeep(encodedTxData)))

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
        const check = await AutoTrigger.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(false, "no upkeep is needed anymore")
    })

})



///Charles trades in opposite direction to Bob
describe("Inverted order", async () => {
    const strikeDelta = ethers.parseUnits("100", 8)
    const bips = 500
    before(async () => {
        //set test oracle price
        await wethOracle.setPrice(initialEthPrice)
        await usdcOracle.setPrice(initialUsdcPrice)

        //fund
        await stealMoney(usdcWhale, await Charles.getAddress(), await USDC.getAddress(), usdcAmount)
    })

    it("Create order", async () => {

        const currentPrice = await AutoTrigger.getExchangeRate(0)

        await USDC.connect(Charles).approve(await AutoTrigger.getAddress(), usdcAmount)
        await AutoTrigger.connect(Charles).createOrder(
            currentPrice - strikeDelta,
            usdcAmount,
            0,
            bips,
            false
        )

        const filter = AutoTrigger.filters.OrderCreated
        const events = await AutoTrigger.queryFilter(filter, -1)
        const event = events[0].args
        //expect(Number(event[0])).to.eq(2, "Second order Id")

        //verify pending order exists
        const list = await AutoTrigger.getPendingOrders()
        expect(list.length).to.eq(1, "1 pending order")

        //verify our input token was received
        const balance = await USDC.balanceOf(await AutoTrigger.getAddress())
        expect(balance).to.eq(usdcAmount, "USDC received")

    })

    it("Check upkeep", async () => {

        //should be no upkeep needed yet
        const initial = await AutoTrigger.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)

        //reduce price to strike price
        await wethOracle.setPrice(initialEthPrice - (strikeDelta))

        //check upkeep
        const result = await AutoTrigger.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")

    })

    it("Perform Upkeep", async () => {
        //check upkeep
        const result = await AutoTrigger.checkUpkeep("0x")

        //get pending order idx
        const decoded = await decodeUpkeepData(result.performData)

        //get perform data
        //we are doing a market swap on univ3 weth => usdc
        const encodedTxData = await generateUniTx(
            router02,
            decoded.pendingOrderIdx,
            router02,
            UniPool,
            USDC,
            await WETH.getAddress(),
            await AutoTrigger.getAddress(),
            usdcAmount,
            await AutoTrigger.getMinAmountReceived(0, false, bips, usdcAmount)
        )
        console.log("Gas to performUpkeep: ", await getGas(await AutoTrigger.performUpkeep(encodedTxData)))

    })

    it("Verify", async () => {

        const wethBalance = await WETH.balanceOf(await Charles.getAddress())
        expect(wethBalance).to.be.gt(0n, "WETH received")

        //pending order removed and length == 0
        expect(await AutoTrigger.PendingOrderIds.length).to.eq(0, "no pending orders left")

        //event
        const filter = AutoTrigger.filters.OrderProcessed
        const events = await AutoTrigger.queryFilter(filter, -1)
        const event = events[0].args
        expect(event.orderId).to.eq(2, "Order Id 2")
        expect(event.success).to.eq(true, "Swap succeeded")

        //no tokens left on contract
        expect(await WETH.balanceOf(await AutoTrigger.getAddress())).to.eq(0n, "0 WETH left on contract")
        expect(await USDC.balanceOf(await AutoTrigger.getAddress())).to.eq(0n, "0 USDC left on contract")

        //check upkeep
        const check = await AutoTrigger.checkUpkeep("0x")
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

    let signers: Signer[]

    before(async () => {
        //reset price
        await wethOracle.setPrice(initialEthPrice)
        currentPrice = await AutoTrigger.getExchangeRate(0)
        signers = await ethers.getSigners()

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
                0,
                npcBips,
                true
            )
        }
    })
    beforeEach(async () => {
        //reset price
        await wethOracle.setPrice(initialEthPrice)
        currentPrice = await AutoTrigger.getExchangeRate(0)

    })
    it("Swap fails due to slippage", async () => {

        //fund and setup andy order
        await stealMoney(wethWhale, await Andy.getAddress(), await WETH.getAddress(), andyWeth)
        await WETH.connect(Andy).approve(await AutoTrigger.getAddress(), andyWeth)
        await AutoTrigger.connect(Andy).createOrder(
            currentPrice + strikeDelta,
            andyWeth,
            0,
            smallSlippage,
            true
        )

        andyOrder1 = Number(await AutoTrigger.orderCount())
        const order = await AutoTrigger.AllOrders(andyOrder1)
        expect(order[4]).to.eq(await Andy.getAddress(), "Andy's order")

        //check upkeep
        const check = await AutoTrigger.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(false, "no upkeep is needed anymore")

        //adjust oracle
        await wethOracle.setPrice(currentPrice + strikeDelta)

        const newCheck = await AutoTrigger.checkUpkeep("0x")
        expect(newCheck.upkeepNeeded).to.eq(true, "upkeep is now needed")

        //pendingOrderIdx is the idx of the pending order id in the pendingOrder array
        const decoded = await decodeUpkeepData(newCheck.performData)
        const list = await AutoTrigger.getPendingOrders()
        const upkeepOrder = await AutoTrigger.AllOrders(list[Number(decoded.pendingOrderIdx)])
        expect(upkeepOrder[0]).to.eq(andyOrder1, "Andy's order")

        //perform
        const txData = await generateUniTx(
            router02,
            decoded.pendingOrderIdx,
            router02,
            UniPool,
            WETH,
            await USDC.getAddress(),
            await AutoTrigger.getAddress(),
            wethAmount,
            await AutoTrigger.getMinAmountReceived(0, true, smallSlippage * 20, wethAmount)
        )
        expect(AutoTrigger.performUpkeep(txData)).to.be.revertedWith("Too Little Received")
    })

    it("Swap fails due to insufficient balance", async () => {
        //adjust oracle
        await wethOracle.setPrice(currentPrice + strikeDelta)

        const newCheck = await AutoTrigger.checkUpkeep("0x")
        expect(newCheck.upkeepNeeded).to.eq(true, "upkeep is now needed")

        const decoded = await decodeUpkeepData(newCheck.performData)
        let list = await AutoTrigger.getPendingOrders()
        const upkeepOrder = await AutoTrigger.AllOrders(list[Number(decoded.pendingOrderIdx)])

        //perform
        const txData = await generateUniTx(
            router02,
            decoded.pendingOrderIdx,
            router02,
            UniPool,
            WETH,
            await USDC.getAddress(),
            await AutoTrigger.getAddress(),
            andyWeth * 5n,//input amount is way too much
            await AutoTrigger.getMinAmountReceived(0, true, smallSlippage, andyWeth)
        )


        //no revert, but process should fail
        await AutoTrigger.performUpkeep(txData)

        const filter = AutoTrigger.filters.OrderProcessed
        const events = await AutoTrigger.queryFilter(filter, -1)
        const event = events[0].args
        expect(event[1]).to.eq(false, "Order Fill Failed")

    })

    it("Cancel frontrun - idx out of bounds", async () => {

        //adjust oracle
        await wethOracle.setPrice(currentPrice + strikeDelta)
        const newCheck = await AutoTrigger.checkUpkeep("0x")
        expect(newCheck.upkeepNeeded).to.eq(true, "upkeep is now needed")
        const decoded = await decodeUpkeepData(newCheck.performData)

        //someone cancels before perform can execute
        const bailer = await ethers.getSigner(await (signers[signers.length - 1]).getAddress())

        //get bailers order
        let list = await AutoTrigger.getPendingOrders()
        let bailerOrderId: BigNumberish
        for (let i = 0; i < list.length; i++) {
            const order = await AutoTrigger.AllOrders(list[i])
            if (order.recipient == await bailer.getAddress()) {
                bailerOrderId = order.orderId
                break
            }
        }
        expect(bailerOrderId!).to.be.gt(0, "order found")
        await AutoTrigger.connect(bailer).cancelOrder(bailerOrderId!)

        //now the pendingOrderIdx should be equal to the length, so the idx is now out of bounds
        list = await AutoTrigger.getPendingOrders()
        expect(list.length).to.eq(decoded.pendingOrderIdx, "idx out of bounds")

        //try to perform upkeep
        const txData = await generateUniTx(
            router02,
            decoded.pendingOrderIdx,
            router02,
            UniPool,
            WETH,
            await USDC.getAddress(),
            await AutoTrigger.getAddress(),
            andyWeth * 5n,//input amount is way too much
            await AutoTrigger.getMinAmountReceived(0, true, smallSlippage, andyWeth)
        )

        expect(AutoTrigger.performUpkeep(txData)).to.be.reverted 

    })

    it("Cancel order frontrun - perform on wrong order", async () => {

    })

    //since Andy's order has bad params and will fail, we cancel it
    it("Cancel Order", async () => {

        expect(AutoTrigger.connect(Bob).cancelOrder(andyOrder1)).to.be.revertedWith("Only Order Owner")

        const initialAndyWeth = await WETH.balanceOf(await Andy.getAddress())
        const initialPendingLength = (await AutoTrigger.getPendingOrders()).length

        await AutoTrigger.connect(Andy).cancelOrder(andyOrder1)

        const finalAndyWeth = await WETH.balanceOf(await Andy.getAddress())
        const finalPendingLength = (await AutoTrigger.getPendingOrders()).length

        expect(finalAndyWeth - initialAndyWeth).to.eq(andyWeth, "Andy received refund")
        expect(initialPendingLength - finalPendingLength).to.eq(1, "Andy's pending order removed")

    })
})

