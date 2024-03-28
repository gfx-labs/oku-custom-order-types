import hre, { ethers, network } from "hardhat";
import { DeployContract } from "../util/deploy";
import { currentBlock, resetCurrent, resetCurrentBase, resetCurrentOP, resetCurrentPoly } from "../util/block";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { MasterKeeper, MasterKeeper__factory } from "../typechain-types";
import { impersonateAccount } from "../util/impersonator";
import { limitOrderData } from "./limitOrderData";

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

    await resetCurrentPoly()
    mainnet = false
    console.log("TEST @ ", await (await currentBlock())!.number)
  } else {
    console.log("Sending for real...")
  }

  const mk = MasterKeeper__factory.connect("0x985A9a95558861ff5ef6CbEFEDfA9d8BfDbdabd1", user)
  const pools = [
    '0x9d8eA62e1264ab667d234b5610774A08e608E3b8',
    '0x14D44c7Ef81F6c18f5D22e0962f0279D83E80b05'
  ]
  //await mk.addPools(pools)
  const list = await mk.getList()
  console.log(await mk.LimitOrderRegistry())
  console.log(list)

  await mk.transferOwnership("0xe75358526Ef4441Db03cCaEB9a87F180fAe80eb9")


  /**
    const ownerAddr = "0x085909388fc0cE9E5761ac8608aF8f2F52cb8B89"
    const owner = await ethers.provider.getSigner(ownerAddr)
    const master = MasterKeeper__factory.connect("0xAaD90A1e789357e98b540b034a7613Cfc06044e7", user)
  
    await impersonateAccount(ownerAddr)
    const receipt = await (await master.connect(owner).addPools(limitOrderData.polygon.oracles[0].tokens[0].address, {gasPrice: 120000000000, nonce: 109})).wait()
    console.log((await receipt?.getTransaction())!.hash)
    
    //await impersonateAccount(ownerAddr)
  
    const tx = {
      to: ownerAddr,
      value: 0,
      nonce: 107,
      gasPrice: 120000000000
    }
  
    await (await owner.sendTransaction(tx)).wait()
     */

  //const result = await master.connect(owner).addPools(limitOrderData.polygon.oracles[0].tokens[0].address)
  //await result.wait()




  //const master = MasterKeeper__factory.connect("0x11104f7C9e50dC07c62904F3d281FC16B123FeB8", user)

  //await master.addPools(newPool)
  //await checkAndExecute(user, master)
  //await addPoolsOp(user)



}

const addPoolsOp = async (signer: SignerWithAddress) => {

  const opPools = [
    "0x68f5c0a2de713a54991e01858fd27a3832401849",
    "0x85149247691df622eaf1a8bd0cafd40bc45154a9",
    "0xfc1f3296458f9b2a27a0b91dd7681c4020e09d05",
    "0x1c3140ab59d6caf9fa7459c6f83d4b52ba881d36",
    "0x1fb3cf6e48f1e7b10213e7b6d87d4c073c7fdb7b",
    "0x85c31ffa3706d1cce9d525a00f1c7d4a2911754c",
    "0x2ab22ac86b25bd448a4d9dc041bd2384655299c4",
    "0x0392b358ce4547601befa962680bede836606ae2",
    "0x04f6c85a1b00f6d9b75f91fd23835974cc07e65c",
    "0xf1f199342687a7d78bcc16fce79fa2665ef870e1",
    "0x8323d063b1d12acce4742f1e3ed9bc46d71f4222",
    "0x73b14a78a0d396c521f954532d43fd5ffe385216",
    "0xb533c12fb4e7b53b5524eab9b47d93ff6c7a456f",
    "0x03af20bdaaffb4cc0a521796a223f7d85e2aac31",
    "0xa73c628eaf6e283e26a7b1f8001cf186aa4c0e8e",
    "0xbf16ef186e715668aa29cef57e2fd7f9d48adfe6",
    "0x252cbdff917169775be2b552ec9f6781af95e7f6",
    "0x535541f1aa08416e69dc4d610131099fa2ae7222",
    "0xb589969d38ce76d3d7aa319de7133bc9755fd840",
    "0xc858a329bf053be78d6239c4a4343b8fbd21472b",
    "0xd1f1bad4c9e6c44dec1e9bf3b94902205c5cd6c3",
    "0x95d9d28606ee55de7667f0f176ebfc3215cfd9c0",
    "0x766854992bd5363ebeeff0113f5a5795796befab",
    "0xd28f71e383e93c570d3edfe82ebbceb35ec6c412",
    "0xa8a5356ee5d02fe33d72355e4f698782f8f199e8",
    "0x4ce4a1a593ea9f2e6b2c05016a00a2d300c9ffd8",
    "0x9438a9d1bdeece02ed4431ac59613a128201e0b9",
    "0xa7bb0d95c6ba0ed0aca70c503b34bc7108589a47",
    "0xadb35413ec50e0afe41039eac8b930d313e94fa4",
    "0xb2ac2e5a3684411254d58b1c5a542212b782114d",
    "0x8eda97883a1bc02cf68c6b9fb996e06ed8fdb3e5",
    "0x19ea026886cbb7a900ecb2458636d72b5cae223b",
    "0x5adba6c5589c50791dd65131df29677595c7efa7",
    "0x730691cdac3cbd4d41fc5eb9d8abbb0cea795b94",
    "0x6168ec836d0b1f0c37381ec7ed1891a412872121",
    "0x2ae3d6096d8215ac2acddf30c60caa984ea5debe",
    "0x394a9fcbab8599437d9ec4e5a4a0eb7cb1fd2f69",
    "0xd52533a3309b393afebe3176620e8ccfb6159f8a",
    "0xbf595eb9a512b1c274125264aef84a2847158eb3",
    "0xf44acaa38be5e965c5ddf374e7a2ba270e580684",
    "0xac85eaf55e9c60ed40a683de7e549d23fdfbeb33",
    "0x250e21dddd306579458cf025c5e230665171fb31",
    "0xe9e3893921de87b1194a8108f9d70c24bde71c27",
    "0xc1738d90e2e26c35784a0d3e3d8a9f795074bca4",
    "0x37ffd11972128fd624337ebceb167c8c0a5115ff",
    "0x2e2d190ad4e0d7be9569baebd4d33298379b0502",
    "0xdc6cb16b8d635ef255cef370263c35ac0007186a",
    "0x8531e48a8611729185be9eaad945acbd6b32e256",
    "0x1d751bc1a723accf1942122ca9aa82d49d08d2ae",
    "0x0ca747e5c527e857d8a71b53b6efbad2866b9e04",
    "0x1d789e3b2146cfa96761996d14cd3cc54a8b133a",
  ]

  const master = MasterKeeper__factory.connect("0x6D746d529F0D0C38A5abD561792917F8c4623E55", signer)
  await master.connect(signer).addPools(opPools)


}

const checkAndExecute = async (signer: SignerWithAddress, master: MasterKeeper) => {

  const result = await master.checkUpkeep("0x")
  console.log(result)

  if (result.upkeepNeeded == true) {
    console.log("Performing...")
    await master.performUpkeep(result.performData)
  }

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