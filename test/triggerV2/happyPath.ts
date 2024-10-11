import { AutomationMaster__factory, Bracket__factory, IERC20__factory, IPermit2__factory, PlaceholderOracle__factory, StopLimit__factory, UniswapV3Pool__factory } from "../../typechain-types"
import { currentBlock, resetCurrentArbBlock } from "../../util/block"
import { expect } from "chai"
import { stealMoney } from "../../util/money"
import { decodeUpkeepData, generateUniTx, generateUniTxData, getGas, MasterUpkeepData, permitSingle } from "../../util/msc"
import { s, SwapParams } from "./scope"
import { DeployContract } from "../../util/deploy"
import { ethers } from "hardhat"
import { a } from "../../util/addresser"
import { AllowanceTransfer } from "@uniswap/permit2-sdk"
import { TypedDataDomain } from "ethers"


///All tests are performed as if on Arbitrum
///Testing is on the Arb WETH/USDC.e pool @ 500
describe("Automated Trigger Testing on Arbitrum", () => {

    before(async () => {
        console.log("STARTING")
        await resetCurrentArbBlock(235660173)
        console.log("Testing on ARB @", (await currentBlock())?.number)

        //connect to signers
        s.signers = await ethers.getSigners()
        s.Frank = s.signers[0]
        s.Andy = s.signers[1]
        s.Bob = s.signers[2]
        s.Charles = s.signers[3]
        s.Steve = s.signers[4]


        s.UniPool = UniswapV3Pool__factory.connect(s.pool, s.Frank)
        s.WETH = IERC20__factory.connect(await s.UniPool.token0(), s.Frank)
        s.USDC = IERC20__factory.connect(await s.UniPool.token1(), s.Frank)
        s.ARB = IERC20__factory.connect("0x912CE59144191C1204E64559FE8253a0e49E6548", s.Frank)
        s.UNI = IERC20__factory.connect("0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0", s.Frank)
        console.log("USDC: ", await s.USDC.getAddress())


    })

    it("Deploy", async () => {
        //deploy master
        s.Master = await DeployContract(new AutomationMaster__factory(s.Frank), s.Frank)
        //deploy stop loss limit
        s.Bracket = await DeployContract(new Bracket__factory(s.Frank), s.Frank, await s.Master.getAddress(), a.permit2)

        //deploy stop limit
        s.StopLimit = await DeployContract(
            new StopLimit__factory(s.Frank),
            s.Frank,
            await s.Master.getAddress(),
            await s.Bracket.getAddress(),
            a.permit2
        )


        //deploy test oracles
        s.wethOracle = await new PlaceholderOracle__factory(s.Frank).deploy(await s.WETH.getAddress())
        s.usdcOracle = await new PlaceholderOracle__factory(s.Frank).deploy(await s.USDC.getAddress())
        s.uniOracle = await new PlaceholderOracle__factory(s.Frank).deploy(await s.UNI.getAddress())
        s.arbOracle = await new PlaceholderOracle__factory(s.Frank).deploy(await s.ARB.getAddress())



    })

    it("Register", async () => {

        //register sup keepers
        await s.Master.connect(s.Frank).registerSubKeepers(
            await s.StopLimit.getAddress(),
            await s.Bracket.getAddress()
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
            0n,//no stop loss
            s.wethAmount,
            await s.WETH.getAddress(),
            await s.USDC.getAddress(),
            await s.Bob.getAddress(),
            strikeBips,
            0,//no stop loss bips
            0,//no swap on fill bips
            false//no swap on fill
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
        expect(balance).to.eq(s.wethAmount, "WETH received")

    })

    it("Check upkeep", async () => {

        //should be no upkeep needed yet
        let initial = await s.Master.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)
        initial = await s.StopLimit.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)

        //reduce price to stop limit price
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
        expect(await s.StopLimit.pendingOrderIds.length).to.eq(0, "no pending orders left")

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


        const filter = s.Bracket.filters.OrderCreated
        const events = await s.Bracket.queryFilter(filter, -1)
        const event = events[0].args
        expect(Number(event[0])).to.eq(1, "First order Id")

        //verify pending order exists
        const list = await s.Bracket.getPendingOrders()
        expect(list.length).to.eq(1, "1 pending order")

        //verify our input token was received
        balance = await s.WETH.balanceOf(await s.Bracket.getAddress())
        expect(balance).to.eq(s.wethAmount, "WETH received")

        //cancel limit order for future tests
        await s.Bracket.connect(s.Bob).cancelOrder(1)
    })

    it("scratchpad", async () => {
        /**
        const PERMIT_DETAILS = [
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint160' },
            { name: 'expiration', type: 'uint48' },
            { name: 'nonce', type: 'uint48' },
        ] as const

        const PERMIT_TYPES = {
            PermitSingle: [
                { name: 'details', type: 'PermitDetails' },
                { name: 'spender', type: 'address' },
                { name: 'sigDeadline', type: 'uint256' },
            ],
            PermitDetails: PERMIT_DETAILS,
        } as const

        const domain = {
            name: 'Permit2',
            chainId,
            verifyingContract: a.permit2,
        }

        const details: PermitDetails = {
            token: a.wethAddress,
            amount: s.wethAmount.toString(),
            expiration: expiration.toString(),
            nonce: nonce.toString()
        }

        const permit:PermitSingle = {
            details: details,
            spender: await s.StopLimit.getAddress(),
            sigDeadline: (expiration * 30).toString()
        }

        const permitData = {
            account,
            domain,
            types: PERMIT_TYPES,
            message: {
                details: {
                    token: permit.details.token as `0x{string}`,
                    amount: BigInt(BigInt(2) ** BigInt(160) - BigInt(1)),
                    expiration: expiration != undefined ? expiration : Number(permit.details.expiration),
                    nonce: Number(permit.details.nonce),
                },
                spender: permit.spender as `0x${string}`,
                sigDeadline: BigInt(permit.sigDeadline),
            },
            primaryType: 'PermitSingle' as keyof typeof PERMIT_TYPES,
        }
         */






        /**
        const provider = new ethers.JsonRpcProvider()
        const network = await provider.getNetwork()

        const PERMIT_EXPIRATION = 2592000 //30d
        const PERMIT_SIG_EXPIRATION = 1800 //30m

        const permitSingle: PermitSingle = {
            details: {
                token: await s.WETH.getAddress(),
                amount: s.wethAmount,
                // You may set your own deadline - we use 30 days.
                expiration: toDeadline(PERMIT_EXPIRATION),
                nonce: await s.Bob.getNonce(),
            },
            spender: await s.Bob.getAddress(),
            // You may set your own deadline - we use 30 minutes.
            sigDeadline: toDeadline(PERMIT_SIG_EXPIRATION),
        }

        const { domain, types, values } = AllowanceTransfer.getPermitData(permitSingle, a.permit2, Number(network.chainId))
        //const sig = await s.Bob.signTypedData(domain, types, values)
         */


        /**
        //permitTransferFrom
         // Define permit and transfer details
        // Example parameters
        const tokenAddress = await s.WETH.getAddress();
        const spender = await s.StopLimit.getAddress();
        const owner = await s.Bob.getAddress();  // Address of the token holder
        const permit2Address = a.permit2; // Address of Permit2 contract
        const deadline = Math.floor(Date.now() / 1000) + 3600; // 1-hour deadline
        const signer = s.Bob
        const amount = s.wethAmount

        // Define permit and transfer details
        const permit = {
            permitted: {
                token: tokenAddress,
                amount: amount, // Replace with correct amount and decimals
            },
            nonce: nonce,
            deadline: deadline,
        };

        const transferDetails = {
            to: spender,
            requestedAmount: amount, // Replace with correct amount
        };

        // Create a signature off-chain using EIP-712 format
        const domain = {
            name: "Permit2",
            version: "1",
            chainId: 42161,
            verifyingContract: permit2Address,
        };


        const types = {
            PermitTransferFrom: [
                { name: "permitted", type: "TokenPermissions" },
                { name: "nonce", type: "uint256" },
                { name: "deadline", type: "uint256" },
            ],
            TokenPermissions: [
                { name: "token", type: "address" },
                { name: "amount", type: "uint256" },
            ],
        };

        const value = {
            permitted: {
                token: permit.permitted.token,
                amount: permit.permitted.amount,
            },
            nonce: permit.nonce,
            deadline: permit.deadline,
        };


        const signature = await signer.signTypedData(domain, types, value);

        console.log("GOT SIG: ", signature)

        await s.StopLimit.connect(s.Bob).createOrderWithPermit(
            currentPrice - stopDelta,
            (currentPrice - stopDelta) + strikeDelta,
            0n,//no stop loss
            s.wethAmount,
            await s.WETH.getAddress(),
            await s.USDC.getAddress(),
            await s.Bob.getAddress(),
            strikeBips,
            0,//no stop loss bips
            0,//no swap on fill bips
            false,//no swap on 
            permit,
            transferDetails,
            signature
        )
        console.log("IT WORKED")


         */

        /**
        // Construct PermitDetails
        const permitDetails = {
            token: a.wethAddress,
            amount: s.wethAmount,
            expiration: expiration,
            nonce: nonce
        };

        // Construct PermitSingle
        const permit = {
            details: permitDetails,
            spender: await s.StopLimit.getAddress(),
            sigDeadline: expiration * 24
        };

        const domain = {
            name: "Permit2",  // Name of the contract (as defined in its domain)
            version: "1",
            chainId: chainId,
            verifyingContract: a.permit2
        };

        const types = {
            PermitDetails: [
                { name: "token", type: "address" },
                { name: "amount", type: "uint160" },
                { name: "expiration", type: "uint48" },
                { name: "nonce", type: "uint48" },
            ],
            PermitSingle: [
                { name: "details", type: "PermitDetails" },
                { name: "spender", type: "address" },
                { name: "sigDeadline", type: "uint256" }
            ]
        };

        // Sign permit data
        const signature = await s.Bob.signTypedData(domain, types, permit);

        const PERMIT = IPermit2__factory.connect(a.permit2, s.Bob)
        console.log("permit: ", a.permit2)

        await s.StopLimit.connect(s.Bob).createOrderWithPermit(
            currentPrice - stopDelta,
            (currentPrice - stopDelta) + strikeDelta,
            0n,//no stop loss
            s.wethAmount,
            await s.WETH.getAddress(),
            await s.USDC.getAddress(),
            await s.Bob.getAddress(),
            strikeBips,
            0,//no stop loss bips
            0,//no swap on fill bips
            false,//no swap on 
            permit,
            signature
        )
        //1728513427
        //1721850057

         */
    })

    it("Check permit2", async () => {
        const currentPrice = await s.Master.getExchangeRate(await s.WETH.getAddress(), await s.USDC.getAddress())




        /**
         // Create a signature off-chain using EIP-712 format
        const domain2 = {
            name: "Permit2",
            version: "1",
            chainId: chainId,
            verifyingContract: a.permit2,
        };

        const types = {
            PermitDetails: [
                { name: "token", type: "address" },
                { name: "amount", type: "uint160" },
                { name: "expiration", type: "uint48" },
                { name: "nonce", type: "uint48" },
            ],
            PermitSingle: [
                { name: "details", type: "PermitDetails" },
                { name: "spender", type: "address" },
                { name: "sigDeadline", type: "uint256" }
            ]
        };
         */

        expect(await s.WETH.balanceOf(await s.Bob.getAddress())).to.eq(s.wethAmount, "Bob has enough weth")

        //approve permit 2
        const PERMIT = IPermit2__factory.connect(a.permit2, s.Frank)

        const approval = await s.WETH.connect(s.Bob).approve(await PERMIT.getAddress(), BigInt(2) ** BigInt(159) - BigInt(1))

        const chainId = 42161
        const expiration = 1728603016 //1 hour
        const nonce = 0
        const data = await permitSingle(
            s.Bob,
            chainId,
            a.wethAddress,
            await s.StopLimit.getAddress(),
            a.permit2,
            0
        )

        //await s.StopLimit.connect(s.Bob).signatureTest(data.permitSingle, data.signature)

    })
})
/**
 * For swap on fill, we expect to receive the same asset we provide
 * In this case, we provide USDC, swap to WETH when the stop limit is filled, 
 * and when the resulting limit order closes, we expect our WETH to be swapped back to USDC
 */
describe("Execute Stop-Limit with swap on fill", () => {
    //0.00029475 => 3,392.70 per ETH
    //0.00029200 => 3424.66
    //as eth price goes up, recip UDSC => ETH price goes down
    const stopLimitPrice = ethers.parseUnits("0.000333", 8)//3k per eth

    //stop and strike price are in eth => usdc terms since we are doing swap on fill
    const strikePrice = ethers.parseUnits("3200", 8)//3.2k per eth
    const stopLoss = ethers.parseUnits("2800", 8)//2.8k per eth
    const strikeBips = 500
    const stopBips = 5000
    const swapBips = 5000//slippage needs to be high as we cannot actually change the price on the pool

    let charlesOrder: BigInt
    //setup
    before(async () => {
        //steal money for s.Bob
        await stealMoney(s.usdcWhale, await s.Charles.getAddress(), await s.USDC.getAddress(), s.usdcAmount)
        //reset test oracle price
        await s.wethOracle.setPrice(s.initialEthPrice)
        await s.usdcOracle.setPrice(s.initialUsdcPrice)
        await s.uniOracle.setPrice(s.initialUniPrice)
        await s.arbOracle.setPrice(s.initialArbPrice)
    })

    it("Create stop-limit order WETH => USDC with swap on fill", async () => {
        await s.USDC.connect(s.Charles).approve(await s.StopLimit.getAddress(), s.usdcAmount)
        await s.StopLimit.connect(s.Charles).createOrder(
            stopLimitPrice,
            strikePrice,
            stopLoss,
            s.usdcAmount,
            await s.USDC.getAddress(),
            await s.WETH.getAddress(),
            await s.Charles.getAddress(),
            strikeBips,
            stopBips,//no stop loss bips
            swapBips,//no swap on fill bips
            true//no swap on fill
        )

        const filter = s.StopLimit.filters.OrderCreated
        const events = await s.StopLimit.queryFilter(filter, -1)
        const event = events[0].args
        expect(Number(event[0])).to.eq(2, "Second order Id")

        //verify pending order exists
        const list = await s.StopLimit.getPendingOrders()
        expect(list.length).to.eq(1, "1 pending order")

        //verify our input token was received
        const balance = await s.USDC.balanceOf(await s.StopLimit.getAddress())
        expect(balance).to.eq(s.usdcAmount, "USDC received")

    })

    it("Check upkeep", async () => {

        //should be no upkeep needed yet
        let initial = await s.Master.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)
        initial = await s.StopLimit.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)

        //reduce price to just above stop limit price
        await s.wethOracle.setPrice(ethers.parseUnits("3003", 8))

        initial = await s.Master.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)
        initial = await s.StopLimit.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)

        //reduce price to just below stop limit price
        await s.wethOracle.setPrice(ethers.parseUnits("3000", 8))

        //check upkeep
        let result = await s.Master.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")
        result = await s.StopLimit.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")
    })

    it("Perform upkeep", async () => {

        //check upkeep
        const result = await s.Master.checkUpkeep("0x")

        //get returned upkeep data
        const data: MasterUpkeepData = await decodeUpkeepData(result.performData, s.Frank)

        //get minAmountReceived
        const minAmountReceived = await s.Master.getMinAmountReceived(data.amountIn, data.tokenIn, data.tokenOut, data.bips)

        //generate encoded masterUpkeepData
        const encodedTxData = await generateUniTx(
            s.router02,
            s.UniPool,
            await s.Bracket.getAddress(),
            minAmountReceived,
            data
        )

        const initOrders = await s.Bracket.orderCount()

        console.log("Gas to performUpkeep: ", await getGas(await s.Master.performUpkeep(encodedTxData)))

        const filter = s.Bracket.filters.OrderCreated
        const events = await s.Bracket.queryFilter(filter, -1)
        const event = events[0].args
        expect(Number(event[0])).to.eq(2, "Second order Id")

        expect(await s.Bracket.orderCount()).to.eq(initOrders + 1n, "New Order Created")
        charlesOrder = await s.Bracket.orderCount()
    })

    it("Verify", async () => {

        //stop limit pending order removed
        expect((await s.StopLimit.getPendingOrders()).length).to.eq(0, "no pending orders left")

        //stop loss limit order created
        expect((await s.Bracket.getPendingOrders()).length).to.eq(1, "new pending order")
        expect(await s.Bracket.pendingOrderIds(0)).to.eq(charlesOrder, "Charles's order is pending")
    })

    it("Check Upkeep", async () => {
        //no upkeep needed yet
        let check = await s.Master.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(false)

        //reduce price to below stop price
        await s.wethOracle.connect(s.Frank).setPrice(stopLoss - 60000000n)
        check = await s.Master.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(true)

        //return to in range
        await s.wethOracle.connect(s.Frank).setPrice(ethers.parseUnits("3000", 8))
        check = await s.Master.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(false)

        //set price to fill price 
        console.log("FINAL")
        await s.wethOracle.connect(s.Frank).setPrice(strikePrice)
        check = await s.Master.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(true)
    })

    it("Perform Upkeep", async () => {
        //check upkeep
        const result = await s.Master.checkUpkeep("0x")

        //get returned upkeep data
        const data: MasterUpkeepData = await decodeUpkeepData(result.performData, s.Frank)

        //get minAmountReceived
        const minAmountReceived = await s.Master.getMinAmountReceived(data.amountIn, data.tokenIn, data.tokenOut, data.bips)

        //generate encoded masterUpkeepData
        const encodedTxData = await generateUniTx(
            s.router02,
            s.UniPool,
            await s.Bracket.getAddress(),
            minAmountReceived,
            data
        )

        console.log("Gas to performUpkeep: ", await getGas(await s.Master.performUpkeep(encodedTxData)))
    })

    it("Verify", async () => {

        expect((await s.Bracket.getPendingOrders()).length).to.eq(0, "no pending orders")

        //USDC received is not perfect as we do not attempt to manipulate the true uni pool price
        let balance = await s.USDC.balanceOf(await s.Charles.getAddress())
        //expect(Number(ethers.formatUnits(balance, 6))).to.be.closeTo(Number(ethers.formatUnits(s.usdcAmount)), 10, "USDC received")
        console.log("todo")



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
        await s.USDC.connect(s.Bob).approve(await s.Bracket.getAddress(), s.usdcAmount)
        const swapInData = await generateUniTxData(
            s.USDC,
            await s.WETH.getAddress(),
            s.usdcAmount,
            s.router02,
            s.UniPool,
            await s.Bracket.getAddress(),
            await s.Master.getMinAmountReceived(s.usdcAmount, await s.USDC.getAddress(), await s.WETH.getAddress(), swapInBips)
        )


        const swapParams: SwapParams = {
            swapTokenIn: await s.USDC.getAddress(),
            swapAmountIn: s.usdcAmount,
            swapTarget: s.router02,
            swapBips: swapInBips,
            txData: swapInData
        }

        await s.Bracket.connect(s.Bob).createOrderWithSwap(
            swapParams,
            currentPrice + strikeDelta,
            currentPrice - stopDelta,
            await s.WETH.getAddress(),
            await s.USDC.getAddress(),
            await s.Bob.getAddress(),
            strikeBips,
            stopBips
        )

        const filter = s.Bracket.filters.OrderCreated
        const events = await s.Bracket.queryFilter(filter, -1)
        const event = events[0].args
        expect(Number(event[0])).to.eq(3, "Third order Id")

        //verify pending order exists
        const list = await s.Bracket.getPendingOrders()
        expect(list.length).to.eq(1, "1 pending order")

        //verify our input token was received
        const balance = await s.WETH.balanceOf(await s.Bracket.getAddress())
        expect(balance).to.be.closeTo(s.wethAmount, 200000000000000000n, "WETH received")

    })

    it("Check upkeep", async () => {

        //should be no upkeep needed yet
        let initial = await s.Master.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)
        initial = await s.Bracket.checkUpkeep("0x")
        expect(initial.upkeepNeeded).to.eq(false)

        //increase price to strike price
        await s.wethOracle.setPrice(s.initialEthPrice + (strikeDelta))

        //check upkeep
        let result = await s.Master.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")
        result = await s.Bracket.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")

        //reset price
        await s.wethOracle.setPrice(s.initialEthPrice)

        //upkeep no longer needed
        result = await s.Master.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(false)
        result = await s.Bracket.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(false)

        //decrease price to stop price
        await s.wethOracle.setPrice(s.initialEthPrice - (stopDelta))

        //upkeep needed again
        result = await s.Master.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")
        result = await s.Bracket.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(true, "Upkeep is now needed")
    })

    it("Perform Upkeep - stop loss", async () => {
        //check upkeep
        const result = await s.Master.checkUpkeep("0x")

        //get returned upkeep data
        const data: MasterUpkeepData = await decodeUpkeepData(result.performData, s.Frank)

        //get minAmountReceived
        const minAmountReceived = await s.Master.getMinAmountReceived(data.amountIn, data.tokenIn, data.tokenOut, data.bips)

        //generate encoded masterUpkeepData
        const encodedTxData = await generateUniTx(
            s.router02,
            s.UniPool,
            await s.Bracket.getAddress(),
            minAmountReceived,
            data
        )

        console.log("Gas to performUpkeep: ", await getGas(await s.Master.performUpkeep(encodedTxData)))

    })
    it("Verify", async () => {
        //expect user to receive tokens
        const usdcBalance = await s.USDC.balanceOf(await s.Bob.getAddress())
        expect(usdcBalance).to.be.gt(0n, "USDC received")

        //pending order removed and length == 0
        expect(await s.Bracket.pendingOrderIds.length).to.eq(0, "no pending orders left")

        //event
        const filter = s.Bracket.filters.OrderProcessed
        const events = await s.Bracket.queryFilter(filter, -1)
        const event = events[0].args
        expect(event.orderId).to.eq(3, "Order Id 3")
        expect(event.success).to.eq(true, "Swap succeeded")

        //no tokens left on contract
        expect(await s.WETH.balanceOf(await s.Bracket.getAddress())).to.eq(0n, "0 s.WETH left on contract")
        expect(await s.USDC.balanceOf(await s.Bracket.getAddress())).to.eq(0n, "0 s.USDC left on contract")

        //check upkeep
        const check = await s.Master.checkUpkeep("0x")
        expect(check.upkeepNeeded).to.eq(false, "no upkeep is needed anymore")
    })
})
