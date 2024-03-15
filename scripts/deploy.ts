import hre, { network } from "hardhat";
import { DeployContract } from "../util/deploy";
import { currentBlock, resetCurrent, resetCurrentArb, resetCurrentBase, resetCurrentBsc, resetCurrentOP, resetCurrentPoly } from "../util/block";
import { MasterKeeper, MasterKeeper__factory } from "../typechain-types";
import { limitOrderData } from "./limitOrderData";
const { ethers } = require("hardhat");

//"https://github.com/adrastia-oracle/oku-automation-config/blob/main/worker-config.ts"


let LOR: string

//SET THIS FOR TESTING
const testingNetwork = "polygon"

let masterKeeper: MasterKeeper
async function main() {
  console.log("STARTING")
  const [user] = await ethers.getSigners()
  let networkName = hre.network.name
  let mainnet = true

  if (networkName == "hardhat" || networkName == "localhost") {
    networkName = testingNetwork
    mainnet = false
    console.log("Testing on network : ", networkName)
  } else {
    console.log("Deploying for real to: ", networkName)
  }

  //config limit order registry
  if (networkName == "op") {
    LOR = limitOrderData.optimism.oracles[0].address
  } else if (networkName == "polygon") {
    LOR = limitOrderData.polygon.oracles[0].address
  } else if (networkName == "arbitrum") {
    LOR = limitOrderData.arbitrumOne.oracles[0].address
  } else if (networkName == "base") {
    LOR = limitOrderData.base.oracles[0].address
  } else if (networkName == "bsc") {
    LOR = limitOrderData.bsc.oracles[0].address
  } else if (networkName == "mainnet") {
    LOR = limitOrderData.ethereum.oracles[0].address
  }

  //set network if testing
  if (!mainnet) {
    if (networkName == "op") {
      await resetCurrentOP()
    } else if (networkName == "polygon") {
      await resetCurrentPoly()
    } else if (networkName == "arbitrum") {
      await resetCurrentArb()
    } else if (networkName == "base") {
      await resetCurrentBase()
    } else if (networkName == "bsc") {
      await resetCurrentBsc()
    } else if (networkName == "mainnet") {
      await resetCurrent()
    }
  }

  //deploy
  //console.log("Deploying....")
  //masterKeeper = await new MasterKeeper__factory(user).deploy(LOR)
  //console.log("Deployed @: ", await masterKeeper.getAddress())

  //set pools
  console.log("Setting pools....")
  if (networkName == "op") {
    await masterKeeper.addPools(limitOrderData.optimism.oracles[0].tokens[0].address)
  } else if (networkName == "polygon") {
    masterKeeper = MasterKeeper__factory.connect("0xAaD90A1e789357e98b540b034a7613Cfc06044e7", user)
    console.log("Setting pools")
    await masterKeeper.addPools(limitOrderData.polygon.oracles[0].tokens[0].address)
  } else if (networkName == "arbitrum") {
    await masterKeeper.addPools(limitOrderData.arbitrumOne.oracles[0].tokens[0].address)
  } else if (networkName == "base") {
    await masterKeeper.addPools(limitOrderData.base.oracles[0].tokens[0].address)
  } else if (networkName == "bsc") {
    await masterKeeper.addPools(limitOrderData.bsc.oracles[0].tokens[0].address)
  } else if (networkName == "mainnet") {
    masterKeeper = MasterKeeper__factory.connect("0x15518AA548248d97479Ca3AE2358266f12B2A61A", user)
    await masterKeeper.addPools(limitOrderData.ethereum.oracles[0].tokens[0].address)
  }

  if (mainnet) {
    console.log("Verifying...")
    await hre.run("verify:verify", {
      address: await masterKeeper.getAddress(),
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
 * op: 0x6D746d529F0D0C38A5abD561792917F8c4623E55
hh verify --network arbitrum 0x560ac74DD8871c9d0d9d70Bdc4f79B82799777b0 "0x54df9e11c7933a9ca3bd1e540b63da15edae40bf"
hh verify --network bsc 0x54fE0D5dA2C787a93f2Dcb4d25E202C4e44e4458 "0x19b9bD76028caB6F414ed1Fc57400b75B5cA0627"
hh verify --network mainnet 0x15518AA548248d97479Ca3AE2358266f12B2A61A "0x54dF9e11c7933a9cA3BD1E540B63dA15edAe40bf"
hh verify --network polygon 0xAaD90A1e789357e98b540b034a7613Cfc06044e7 "0x54dF9e11c7933a9cA3BD1E540B63dA15edAe40bf"
*/

/**
 * Optimism 0x6D746d529F0D0C38A5abD561792917F8c4623E55
 * Arbitrum 0x560ac74DD8871c9d0d9d70Bdc4f79B82799777b0 
 * Base 0xd829adF0FB755f38d1d691f822619C3fBaa5ccD0 
 * BSC 0x54fE0D5dA2C787a93f2Dcb4d25E202C4e44e4458 
 * Mainnet 0x15518AA548248d97479Ca3AE2358266f12B2A61A
 * Polygon 0xAaD90A1e789357e98b540b034a7613Cfc06044e7
 */

/**
[0x847b64f9d3a95e977d157866447a5c0a5dfa0ee5, 0x0e44ceb592acfc5d3f09d996302eb4c499ff8c10, 0x167384319b41f7094e62f7506409eb38079abff8, 0x94ab9e4553ffb839431e37cc79ba8905f45bfbea, 0x88f3c15523544835ff6c738ddb30995339ad57d6, 0x45dda9cb7c25131df268515131f647d726f50608, 0xa374094527e1673a86de625aa59517c5de346d32, 0x9b08288c3be4f62bbf8d1c20ac9c5e6f9467d8b7, 0x50eaedb835021e4a108b7290636d62e9765cc6d7, 0x86f1d8390222a3691c28938ec7404a1661e618e0, 0xeef1a9507b3d505f0062f2be9453981255b503c8, 0x1f6082db7c8f4b199e17090cd5c8831a1dad1997, 0xdac8a8e6dbf8c690ec6815e0ff03491b2770255d, 0x3a5329ee48a06671ad1bf295b8a233ee9b9b975e, 0x0a63d3910ffc1529190e80e10855c4216407cc45, 0x5645dcb64c059aa11212707fbf4e7f984440a8cf, 0x7de263d0ad6e5d208844e65118c3a02a9a5d56b6, 0x2aceda63b5e958c45bd27d916ba701bc1dc08f7a, 0x4d05f2a005e6f36633778416764e82d1d12e7fbb, 0x3d0acd52ee4a9271a0ffe75f9b91049152bac64b, 0x3e31ab7f37c048fc6574189135d108df80f0ea26, 0xd866fac7db79994d08c0ca2221fee08935595b4b, 0x98b9162161164de1ed182a0dfa08f5fbf0f733ca, 0x4ccd010148379ea531d6c587cfdd60180196f9b1, 0xfe343675878100b344802a6763fd373fdeed07a4, 0x357faf5843c7fd7fb4e34fbeabdac16eabe8a5bc, 0xb6e57ed85c4c9dbfef2a68711e9d6f36c56e0fcb, 0x0a28c2f5e0e8463e047c203f00f649812ae67e4f, 0xd36ec33c8bed5a9f7b6630855f1533455b98a418, 0xa4d8c89f0c20efbe54cba9e7e7a7e509056228d9, 0x36165b14423425228d7ef62b3ffa799d446347c1, 0x31083a78e11b18e450fd139f9abea98cd53181b7, 0x79e4240e33c121402dfc9009de266356c91f241d, 0x254aa3a898071d6a2da0db11da73b02b4646078f, 0x7e02ae3f794ebade542c92973eb1c46d7e2e935d, 0x3d86a4b8c1b55509792d57e0c038128cc9c14fe7, 0x3f5228d0e7d75467366be7de2c31d0d098ba2c23, 0x3fa147d6309abeb5c1316f7d8a7d8bd023e0cd80, 0x1e5bd2ab4c308396c06c182e1b7e7ba8b2935b83, 0xcf0bb95967cd006f5eaa1463c9d710d1e1550a96, 0xa9077cdb3d13f45b8b9d87c43e11bce0e73d8631, 0xc4c06c9a239f94fc0a1d3e04d23c159ebe8316f1, 0x647fb01a63de9a551b39c7915693b25e6bcec502, 0xb2131540048397d2c958bb5cc38b6db0e3c8fe88, 0x6b75f2189f0e11c52e814e09e280eb1a9a8a094a, 0x41e64a5bc929fa8e6a9c8d7e3b81a13b21ff3045, 0x19c5505638383337d2972ce68b493ad78e315147, 0x8837a61644d523cbe5216dde226f8f85e3aa9be3, 0xefa98fdf168f372e5e9e9b910fcdfd65856f3986, 0x32fae204835e08b9374493d6b4628fd1f87dd045, 0x941061770214613ba0ca3db9a700c39587bb89b6, 0xe6ba22265aefe9dc392f544437acce2aedf8ef36, 0xda908c0bf14ad0b61ea5ebe671ac59b2ce091cbf, 0xa236278bec0e0677a48527340cfb567b4e6e9adc, 0x781067ef296e5c4a4203f81c593274824b7c185d, 0xf369277650ad6654f25412ea8bfbd5942733babc, 0x60ea32a35f64628328f578c872dd6c6d81626aba, 0xc42bf5cd16d9eb1e892b66bb32a3892dcb7bb75c, 0x7f9121b4f4e040fd066e9dc5c250cf9b4338d5bc, 0x1cedfb6819e3ce98ea0e7ea253e6866d7fcccc16, 0x2a08c38c7e1fa969325e2b64047abb085dec3756, 0xa830ff28bb7a46570a7e43dc24a35a663b9cfc2e, 0xfa22d298e3b0bc1752e5ef2849cec1149d596674, 0x849ec65748107aedc518dbc42961f358ea1361a7, 0xbb98b3d2b18aef63a3178023a920971cf5f29be4, 0xb035b6593fcf5ebff11fb16730c6bc023a61f9d3, 0x1de01edb36d0f51762dac6645f0639462cf73933]
 */
