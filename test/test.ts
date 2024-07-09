import { IERC20, IERC20__factory, ILimitOrderRegistry, ILimitOrderRegistry__factory, MasterKeeper, MasterKeeper__factory, UniswapV3Pool, UniswapV3Pool__factory } from "../typechain-types"
import { reset } from "../util/block"
import { DeployContract } from "../util/deploy"
import { Signer } from "ethers"
import { ethers } from "hardhat"
import { expect } from "chai"

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
let Bob: Signer
let Andy: Signer

describe("Master Upkeep Testing", () => {



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
        await master.addPools(pools)

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
        await master.addPools([wbtcUsdc3000])
        await master.addPools(pools)

    })

    it("Check upkeep", async () => {

        const result = await master.checkUpkeep("0x")
        expect(result.upkeepNeeded).to.eq(false)
        expect(result.performData).to.eq("0x")
    })
})

describe("Execute an Upkeep", () => {

    //amounts are ~5k
    const wbtcAmount = BigInt("7500000")
    const wethAmount = BigInt("1300000000000000000")

    let registry: ILimitOrderRegistry
    let pool: UniswapV3Pool

    let PEPE: IERC20//0x6982508145454Ce325dDbE47a25d4ec3d2311933
    let WETH: IERC20
    const avaxBridge = "0x8EB8a3b98659Cce290402893d0123abb75E3ab28"

    before(async () => {
        //there is a known performUpkeep @ block 19325298 on the PEPE/WETH pool
        await reset(19325297)
        registry = ILimitOrderRegistry__factory.connect(LimitOrderRegistry, Bob)

        //PEPE 4
        pool = UniswapV3Pool__factory.connect("0x11950d141EcB863F01007AdD7D1A342041227b58", Bob)

        WETH = IERC20__factory.connect("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", Bob)
        PEPE = IERC20__factory.connect("0x6982508145454Ce325dDbE47a25d4ec3d2311933", Bob)

        master = await DeployContract(
            new MasterKeeper__factory(Bob),
            Bob,
            LimitOrderRegistry
        )
        await master.deploymentTransaction()

    })

    it("Register the pool", async () => {
        await master.connect(Bob).addPools([await pool.getAddress()])
        const list = await master.getList()
        expect(list.length).to.eq(1, "Pool added")
    })

    it("Check, perform, and verify upkeep", async () => {

        const wethBefore = await WETH.balanceOf(LimitOrderRegistry)
        const pepeBefore = await PEPE.balanceOf(LimitOrderRegistry)

        const result = await master.checkUpkeep("0x")

        expect(result.upkeepNeeded).to.eq(true, "Upkeep is needed")
        expect(result.performData).to.not.eq("0x", "Perform data")

        await master.performUpkeep(result.performData)

        //compare to https://etherscan.io/tx/0x0f6000a51ace0fa2dfc54bb9364e9945d43a105760f3e868056783c04cc25a12
        const wethAfter = await WETH.balanceOf(LimitOrderRegistry)
        const pepeAfter = await PEPE.balanceOf(LimitOrderRegistry)
        const wethDelta = wethAfter - (wethBefore)
        const pepeDelta = pepeAfter - (pepeBefore)
        const expectedWethDelta = BigInt("125583978373660380")
        const expectedPepeDelta = BigInt("945550520850024117930790")
        expect(wethDelta).to.be.closeTo(expectedWethDelta, 10, "WETH Match")
        expect(pepeDelta).to.be.closeTo(expectedPepeDelta, 10, "PEPE Match")
    })
})