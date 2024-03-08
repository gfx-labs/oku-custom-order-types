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
    base: {
      url: process.env.BASE_URL ? process.env.BASE_URL : zaddr,
      accounts: [
        process.env.MAINNET_PRIVATE_KEY
          ? process.env.MAINNET_PRIVATE_KEY
          : zaddr
      ],
      chainId: 8453
    }
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.API_KEY!,
      ropsten: process.env.API_KEY!,
      polygon: process.env.ETHERSCAN_POLYGON_KEY!,
      optimisticEthereum: process.env.OP_KEY!
    },
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://rpc.ankr.com/base",
          browserURL: "https://basescan.org/api"
        }
      },
      {
        network: "routescan",
        chainId: 43114,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan",
          browserURL: "https://routescan.io"
        }
      }
    ]
  },
  solidity: "0.8.24",
};

export default config;
