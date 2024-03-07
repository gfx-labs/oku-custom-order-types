import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();
const zaddr =
  "0000000000000000000000000000000000000000000000000000000000000000";
const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      forking: {
        url: process.env.MAINNET_URL ? process.env.MAINNET_URL : zaddr
      },
      mining: {
        auto: true
      },
    },
    op: {
      url: process.env.OP_URL ? process.env.OP_URL : zaddr,
      accounts: [
        process.env.MAINNET_PRIVATE_KEY
          ? process.env.MAINNET_PRIVATE_KEY
          : zaddr,
        process.env.PERSONAL_PRIVATE_KEY
          ? process.env.PERSONAL_PRIVATE_KEY
          : zaddr
      ],
      minGasPrice: 32000000000,
      chainId: 10

    },
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.API_KEY!,
      ropsten: process.env.API_KEY!,
      polygon: process.env.ETHERSCAN_POLYGON_KEY!,
      optimisticEthereum: process.env.OP_KEY!
    },
  },
  solidity: "0.8.24",
};

export default config;
