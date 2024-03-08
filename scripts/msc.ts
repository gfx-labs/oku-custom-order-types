import hre, { ethers, network } from "hardhat";
import { DeployContract } from "../util/deploy";
import { MasterKeeper__factory } from "../typechain-types";
import { currentBlock, resetCurrent, resetCurrentBase, resetCurrentOP } from "../util/block";

const opLOR = "0x54dF9e11c7933a9cA3BD1E540B63dA15edAe40bf"
const mainnetLOR = "0x54dF9e11c7933a9cA3BD1E540B63dA15edAe40bf"
const baseLOR = "0xfF8b754c64e9a8473Bd6E1118d0eaC67F0A8Ae27"
const LOR = baseLOR

async function main() {

  const accounts = await ethers.getSigners();
  const user = accounts[0];


  const networkName = hre.network.name
  let mainnet = true

  if (networkName == "hardhat" || networkName == "localhost") {

    await resetCurrentBase()
    mainnet = false
    console.log("TEST @ ", await (await currentBlock()).number)
  } else {
    console.log("Sending for real...")
  }

  const pools = [
    "0x4c36388be6f416a29c8d8eee81c771ce6be14b18",
    "0x06959273e9a65433de71f5a452d529544e07ddd0",
    "0xc9034c3e7f58003e6ae0c8438e7c8f4598d5acaa",
    "0xd0b53d9277642d899df5c87a3966a349a798f224",
    "0x48413707b70355597404018e7c603b261fcadf3f",
    "0x4b0aaf3ebb163dd45f663b38b6d93f6093ebc2d3",
    "0x0d5959a52e7004b601f0be70618d01ac3cdce976",
    "0x10648ba41b8565907cfa1496765fa4d95390aa0d",
    "0x22f9623817f152148b4e080e98af66fbe9c5adf8",
    "0xae2ce200bdb67c472030b31f602f0756c9aeb61c",
    "0xd5638bf58e2762fa40bd753490f693cbb1986709",
    "0x018046b1d182f7c0978c07610e1173c8e11913fd",
    "0x24e1cbd6fed006ceed9af0dce688acc7951d57a9",
    "0x97a25cc2793f0ffa90e1667cf7b3c1f130737189",
    "0xfcc89a1f250d76de198767d33e1ca9138a7fb54b",
    "0x3bc5180d5439b500f381f9a46f15dd6608101671",
    "0xa555149210075702a734968f338d5e1cbd509354",
    "0x5197195ac878741b192f84ff6d7da5a85b9e634b",
    "0xe745a591970e0fa981204cf525e170a2b9e4fb93",
    "0x7e904aaf3439402eb21958fe090bd852d5e882cf",
    "0x0b1c2dcbbfa744ebd3fc17ff1a96a1e1eb4b2d69"
  ]


  const master = MasterKeeper__factory.connect("0x11104f7C9e50dC07c62904F3d281FC16B123FeB8", user)

  await master.addPools(pools)



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