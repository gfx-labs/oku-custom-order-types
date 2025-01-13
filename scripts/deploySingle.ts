import hre from "hardhat";
import { DeployContract } from "../util/deploy";
import { Signer } from "ethers";
import { ChainConfig, chainConfigs, CoreDeployments, OraclePair } from "./chainConfig";
import { resetGeneric } from "../util/block";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { impersonateAccount } from "../util/impersonator";
import { ChainAddresses, getAddressesByChainId, getFeeByChainId, tokenInfo } from "../util/deploymentAddresses";
import { AutomationMaster, AutomationMaster__factory, Bracket, Bracket__factory, IAutomationMaster__factory, OracleLess, OracleLess__factory, OracleRelay__factory, StopLimit, StopLimit__factory } from "../typechain-types";
import { network } from "hardhat"

const { ethers } = require("hardhat");
let mainnet = true
let chainId: number
const zaddr = "0x0000000000000000000000000000000000000000"
type verification = {
    address: string,
    constructorArguments: string[]
}
let verifications: verification[] = []

//set these
const testingNetworkChainId = 10
const userAddr = "0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89"
const protocolOwner = "0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89"
const maxPendingOrders = 50
const minOrderDollars = ethers.parseUnits("1", 8)


let config: ChainConfig

async function main() {
    console.log("STARTING")
    let networkName = hre.network.name
    let signer: Signer

    if (networkName == "hardhat" || networkName == "localhost") {
        //testing
        mainnet = false
        chainId = testingNetworkChainId
    } else {
        console.log("DEPLOYING TO LIVE NETWORK: ", networkName)
        const network = await ethers.provider.getNetwork()
        chainId = Number(network.chainId)
    }

    //get config
    config = chainConfigs.find(config => config.chainId == chainId)!

    //setup testing
    if (!mainnet) {
        //reset generic
        try {
            console.log(`Resetting network to ${config.name}`)
            await resetGeneric(config.rpcUrl)
        } catch (e) {
            console.log("Resseting RPC failed for ", config.name)
            process.exit(1)
        }
        signer = await ethers.getSigner(userAddr)
        await setBalance(userAddr, ethers.parseEther("1000"))
        await impersonateAccount(userAddr)
    } else {
        //live network
        //setup provider and signer
        const provider = new ethers.JsonRpcProvider(config.rpcUrl)
        signer = new ethers.Wallet(config.privateKey, provider)
    }

    const addresses: ChainAddresses = getAddressesByChainId(config.chainId)

    let oracles: OraclePair[] = []
    if (config.chainlink) {
        oracles = await deployOracles(signer, config, addresses)
    }
    //deploy contracts
    const coreDeployments = await deployContracts(signer, config, addresses, oracles)
    console.log("Core Deployments for: ", config.name)
    console.log(coreDeployments)

    //verify all at once
    if (mainnet) {
        await verifyAll().catch((error) => {
            console.error("Error during verification:", error);
        });
    }
    console.log("DONE")
}

const deployOracles = async (signer: Signer, config: ChainConfig, addresses: ChainAddresses) => {
    console.log("DEPLOYING ORACLES ON ", config.name)
    let oracles: OraclePair[] = []

    const tokens: tokenInfo[] = addresses.allTokens

    let verification: verification = {
        address: "",
        constructorArguments: []
    }

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i]

        let oraclePair: OraclePair = {
            token: token.token,
            oracle: token.relay
        }

        //can't do anything if there is no token addr
        if (token.token == '') {
            console.log(`No token addr for ${token.symbol} on ${config.name}`)
            continue
        }

        //if we have a feed
        if (token.relay != '') {
            console.log(`Found relay for ${token.symbol} on ${config.name} @ ${token.relay}`)
            oracles.push(oraclePair)
            continue
        }


        //if there is no relay and we have a feed, deploy a relay
        if (token.relay == '' && token.feed != '') {
            console.log("Deploying oracle for ", token.symbol)
            const oracle = await DeployContract(new OracleRelay__factory(signer), signer, ethers.getAddress(token.token), ethers.getAddress(token.feed))
            await oracle!.deploymentTransaction()
            console.log(`${token.symbol} Oracle Deployed to ${config.name} @ ${await oracle!.getAddress()}`)
            console.log(`${token.symbol} PRICE: `, await oracle!.currentValue())
            oraclePair.oracle = await oracle.getAddress()
            oracles.push(oraclePair)
            verification = {
                address: await oracle.getAddress(),
                constructorArguments: [token.token, token.feed]
            }
        }
    }
    //verify the last one
    if (verification.address != "") {
        verifications.push(verification)
    }

    return oracles
}

const deployContracts = async (signer: Signer, config: ChainConfig, addresses: ChainAddresses, oracles: OraclePair[]) => {
    //init to what we have
    let coreDeployments: CoreDeployments = {
        master: addresses.coreDeployments.master,
        bracket: addresses.coreDeployments.bracket,
        stopLimit: addresses.coreDeployments.stopLimit,
        oracleLess: addresses.coreDeployments.oracleLess
    }
    let newMaster = false

    if (coreDeployments.master == '') {
        //deploy
        const master: AutomationMaster = await DeployContract(new AutomationMaster__factory(signer), signer, protocolOwner)
        await master.deploymentTransaction()
        console.log(`Master deployed to ${config.name} @ ${await master.getAddress()}`)
        newMaster = true
        coreDeployments.master = await master.getAddress()

        //register oracles
        //split oracle pairs
        const tokenAddrs = oracles.map(pair => ethers.getAddress(pair.token));
        const oracleAddrs = oracles.map(pair => ethers.getAddress(pair.oracle));
        console.log("TOKENS: ", tokenAddrs)
        console.log("ORACLE: ", oracleAddrs)

        let tx = await master.registerOracle(tokenAddrs, oracleAddrs)
        await tx.wait()
        console.log("Registered Oracles on Master on ", config.name)

        tx = await master.setMinOrderSize(minOrderDollars)
        await tx.wait()
        console.log(`Set min order size to ${minOrderDollars} on ${config.name}`)
        tx = await master.setMaxPendingOrders(maxPendingOrders)
        await tx.wait()
        console.log(`Set max pending orders to ${maxPendingOrders} on ${config.name}`)

    }

    if (coreDeployments.bracket == '') {
        let permit2 = addresses.permit2
        if (permit2 == "") {
            permit2 = zaddr
        }
        //deploy
        const bracket: Bracket = await DeployContract(new Bracket__factory(signer), signer, coreDeployments.master, addresses.permit2, protocolOwner)
        await bracket.deploymentTransaction()
        console.log(`Bracket deployed to ${config.name} @ ${await bracket.getAddress()}`)
        coreDeployments.bracket = await bracket.getAddress()

        verifications.push({
            address: await bracket.getAddress(),
            constructorArguments: [coreDeployments.master, addresses.permit2, protocolOwner]
        })
    }

    if (coreDeployments.stopLimit == '') {
        //deploy
        const stopLimit: StopLimit = await DeployContract(new StopLimit__factory(signer), signer, coreDeployments.master, coreDeployments.bracket, addresses.permit2, protocolOwner)
        await stopLimit.deploymentTransaction()
        console.log(`Stop Limit deployed to ${config.name} @ ${await stopLimit.getAddress()}`)
        coreDeployments.stopLimit = await stopLimit.getAddress()

        verifications.push({
            address: await stopLimit.getAddress(),
            constructorArguments: [coreDeployments.master, coreDeployments.bracket, addresses.permit2, protocolOwner]
        })
    }

    if (coreDeployments.oracleLess == '') {
        //deploy
        const oracleLess: OracleLess = await DeployContract(new OracleLess__factory(signer), signer, coreDeployments.master, addresses.permit2, protocolOwner)
        await oracleLess.deploymentTransaction()
        console.log(`OracleLess deployed to ${config.name} @ ${await oracleLess.getAddress()}`)
        coreDeployments.oracleLess = await oracleLess.getAddress()

        //set fee
        let tx = await oracleLess.setOrderFee(getFeeByChainId(config.chainId))
        await tx.wait()
        console.log("Set fee on Oracleless")

        verifications.push({
            address: await oracleLess.getAddress(),
            constructorArguments: [coreDeployments.master, addresses.permit2, protocolOwner]
        })
    }

    if (newMaster) {
        //register sub keepers
        const master = AutomationMaster__factory.connect(coreDeployments.master, signer)
        let tx = await master.registerSubKeepers(
            coreDeployments.stopLimit,
            coreDeployments.bracket
        )
        await tx.wait()
        console.log("Sub Keepers Registered to Master on ", config.name)
        const result = await master.checkUpkeep("0x")
        console.log("Upkeep Needed: ", result.upkeepNeeded)
    }

    console.log("Core deployments complete for ", config.name)
    return coreDeployments

}

async function verifyAll() {
    console.log(`Submitting ${verifications.length} verifications...`)
    console.log(verifications)

    const verificationPromises = verifications.map(async (verification) => {
        return await hre.run("verify:verify", {
            address: verification.address,
            constructorArguments: verification.constructorArguments,
        });
    });

    await Promise.all(verificationPromises);
    console.log("All verifications completed!");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
