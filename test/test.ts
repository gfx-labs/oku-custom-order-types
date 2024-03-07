import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { IERC20, IERC20__factory, ILimitOrderRegistry, ILimitOrderRegistry__factory, MasterKeeper, MasterKeeper__factory, UniswapV3Pool, UniswapV3Pool__factory } from "../typechain-types"
import { currentBlock, resetCurrentBase, resetCurrentOP } from "../util/block"
import { DeployContract } from "../util/deploy"
import { Signer } from "crypto"
import { ethers } from "hardhat"
import { expect } from "chai"
import { stealMoney } from "../util/money"
import { BN } from "../util/number"



describe("Master Upkeep Testing", () => {

    const LimitOrderRegistry = "0x54dF9e11c7933a9cA3BD1E540B63dA15edAe40bf"//mainnet
    const usdcWeth500 = "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640"
    const wbtcWeth500 = "0x4585fe77225b41b697c938b018e2ac67ac5a20c0"
    const wstEthWeth100 = "0x109830a1aaad605bbf02a9dfa7b0b92ec2fb7daa"
    const pools = [
        usdcWeth500,
        wbtcWeth500,
        wstEthWeth100
    ]

    const wbtcUsdc3000 = "0x99ac8ca7087fa4a2a1fb6357269965a2014abc35"

    let master: MasterKeeper
    let Bob: SignerWithAddress
    let Andy: SignerWithAddress

    before(async () => {
        console.log("STARTING")

        //connect to signers
        const signers = await ethers.getSigners()
        Bob = signers[0]
        Andy = signers[1]

        //deploy masterUpkeep  
        master = await DeployContract(
            new MasterKeeper__factory(Bob),
            Bob,
            LimitOrderRegistry
        )
    })

    it("Register Pools", async () => {
        for (const pool in pools) {
            await master.addPool(pools[pool])
        }

        const list = await master.getList()
        expect(list.length).to.eq(3, "List length is correct")

    })

    it("Remove specific pool", async () => {
        //remove idx 1, the middle pool
        await master.removePool(1)

        const list = await master.getList()
        expect(list.length).to.eq(2, "List length is correct")

        const expected = [pools[0].toUpperCase(), pools[2].toUpperCase()]

        expect(list[0].toUpperCase()).to.eq(expected[0])
        expect(list[1].toUpperCase()).to.eq(expected[1])

    })

    it("Clear pools", async () => {
        await master.clearPools()
        const list = await master.getList()
        expect(list.length).to.eq(0, "All pools removed")

    })

    it("Add pools again", async () => {
        await master.addPool(wbtcUsdc3000)
        for (const pool in pools) {
            await master.addPool(pools[pool])
        }
    })

    it("Check upkeep", async () => {

        const result = await master.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(false)
        expect(result.performData).to.eq("0x")
    })

    describe("Execute an Upkeep", () => {

        //amounts are ~5k
        const wbtcAmount = BN("7500000")
        const wethAmount = BN("13e17")

        let registry: ILimitOrderRegistry
        let pool: UniswapV3Pool

        let WBTC: IERC20
        let WETH: IERC20

        before(async () => {
            registry = ILimitOrderRegistry__factory.connect(LimitOrderRegistry, Bob)
            pool = UniswapV3Pool__factory.connect(wbtcUsdc3000, Bob)

            WBTC = IERC20__factory.connect("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", Bob)
            WETH = IERC20__factory.connect("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", Bob)

            //steal money
            const avaxBridge = "0x8EB8a3b98659Cce290402893d0123abb75E3ab28"
            await stealMoney(avaxBridge, Bob.address, WBTC.address, wbtcAmount)
            await stealMoney(avaxBridge, Bob.address, WETH.address, wethAmount)

        })

        it("Make an order", async () => {
            const poolData = await pool.slot0()
            const spacing = await pool.tickSpacing()
            console.log(poolData)
            console.log(spacing)


            //confirm pool is setup
            const result = await registry.poolToData(pool.address)
            expect(result.token0).to.not.eq(ethers.constants.AddressZero, "pool registered")

            //approve
            await WBTC.approve(registry.address, wbtcAmount)

            //newOrder

            /**
            await registry.newOrder(
                pool.address,
                poolData.tick - (spacing * 5),
                wbtcAmount,
                true,
                0,
                (await currentBlock()).timestamp + 500
            )
             */

        })

        it("Do a giant swap to trigger the order", async () => {

        })

        it("Check upkeep", async () => {


        })

        it("Perform upkeep", async () => {
            console.log("qqqqqqqqq")

        })
    })



    it("Done", async () => {
        console.log("DONE")
    })
})