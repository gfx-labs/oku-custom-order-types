import hre from "hardhat";
import { DeployContract } from "../util/deploy";
import { currentBlock, resetCurrentArb, resetCurrentBase, resetCurrentOP, resetGeneric } from "../util/block";
import { AutomationMaster, AutomationMaster__factory, Bracket, Bracket__factory, IERC20__factory, IOracleRelay, OracleRelay__factory, StopLimit, StopLimit__factory, TokenEthRelay__factory, UniswapV3Pool__factory } from "../typechain-types";
import { Signer } from "ethers";
import { impersonateAccount } from "../util/impersonator";
import { setBalance } from "@nomicfoundation/hardhat-network-helpers";
import { decodeUpkeepData, generateUniTx } from "../util/msc";
import { chainConfigs } from "./chainConfig";
import { getAddressesByChainId } from "../util/deploymentAddresses"


const { ethers } = require("hardhat");

//"https://github.com/adrastia-oracle/oku-automation-config/blob/main/worker-config.ts"


const userAddr = "0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89"

let mainnet = true
async function main() {
  console.log("STARTING")
  let networkName = hre.network.name
  console.log(networkName)
  if (networkName == "hardhat" || networkName == "localhost") {
    //testing
    mainnet = false
  } else {
    console.log("DEPLOYING TO LIVE NETWORKS")
  }

  for (const config of chainConfigs) {
    let signer: Signer
    //reset for testing
    if (!mainnet) {
      try {
        await resetGeneric(config.rpcUrl!)
      } catch (e) {
        console.log("Resseting RPC failed for ", config.name)
        continue
      }
      signer = await ethers.getSigner(userAddr)
      await setBalance(userAddr, ethers.parseEther("1"))
      await impersonateAccount(userAddr)
    } else {
      console.log("Deploying to: ", config.name)
      const provider = new ethers.JsonRpcProvider(config.rpcUrl)
      signer = new ethers.Wallet(config.privateKey, provider)
    }
    try {
      const a = getAddressesByChainId(config.chainId)
      await deployAndSetup(signer, config, a)

    } catch (e) {
      console.log(e)
      continue
    }
  }
}

const deployAndSetup = async (signer: Signer, config: any, a: any) => {

  //deploy oracles
  /**
  let oracles: IOracleRelay[]
  if (config.chainlink) {
    oracles = await deployOracles(signer, config, a)
  }
   */
  const oracles = await bulkDeployOracles(signer, config, a)
  console.log(`Got ${oracles.length}`)

  //deploy contracts

  //setup contracts

  //submit for verification
}

type oraclePair = {
  token: string,
  oracle: string
}

const bulkDeployOracles = async (signer: Signer, config: any, a: any) => {

  console.log(a.clFeeds)
  const feeds = a.clFeeds
  const tokens = Object.entries(a.tokens).map(([key, value]) => value);
  console.log(tokens)

  let oracles: oraclePair[] = []

  let idx = 0
  for (const feed in feeds) {
    const tokenName = feed.split("Feed")[0]
    const feedAddress = feeds[feed]
    //console.log(`Token: ${tokenName}, Address: ${feedAddress}`);
    if (feedAddress != "" && tokens[idx] != "") {
      //deploy
      console.log(`Deploying ${tokenName} Oracle`)
      const oracle = await DeployContract(new OracleRelay__factory(signer), signer, tokens[idx], feedAddress)
      await oracle!.deploymentTransaction()
      console.log(`${tokenName} Oracle Deployed to ${config.name} @ ${await oracle!.getAddress()}`)
      console.log(`${tokenName} PRICE: `, await oracle!.currentValue())

      const pair: oraclePair = {
        token: tokens[idx] as string,
        oracle: await oracle.getAddress()
      }
      oracles.push(pair)

    }
    idx += 1
  }
  return oracles
}


const deployContracts = async (signer: Signer, config: any, a: any) => {

}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })


