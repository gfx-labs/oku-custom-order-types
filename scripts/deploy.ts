import hre, { ethers, network } from "hardhat";
import { DeployContract } from "../util/deploy";
import { MasterKeeper__factory } from "../typechain-types";
import { currentBlock, resetCurrent, resetCurrentOP } from "../util/block";

const opLOR = "0x54dF9e11c7933a9cA3BD1E540B63dA15edAe40bf"
const mainnetLOR = "0x54dF9e11c7933a9cA3BD1E540B63dA15edAe40bf"

const LOR = opLOR

async function main() {

  const accounts = await ethers.getSigners();
  const user = accounts[0];


  const networkName = hre.network.name
  let mainnet = true

  if (networkName == "hardhat" || networkName == "localhost") {

    await resetCurrent()
    mainnet = false
    console.log("TEST DEPLOYMENT @ ", await (await currentBlock()).number)
  } else {
    console.log("Deploying for real...")
  }

  const masterUpkeep = await DeployContract(
    new MasterKeeper__factory(user),
    user,
    LOR
  )
  await masterUpkeep.deployed()
  console.log("Deployed to: ", masterUpkeep.address)

  if (mainnet) {
    console.log("Verifying...")
    await hre.run("verify:verify", {
      address: masterUpkeep.address,
      constructorArguments: [
        LOR
      ]
    })
    console.log("verified")

  }
  console.log("DONE")
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })


/**
hh verify --network op 0xfd41F406585eEE2A4BDF89b790172E1e5eE00036 "0x54dF9e11c7933a9cA3BD1E540B63dA15edAe40bf"
*/