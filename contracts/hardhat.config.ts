import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Solidity sources live in src/, not the Hardhat-default contracts/,
// because this project's top-level directory is itself named contracts/.
// See docs/adr/0002-repo-layout-and-tooling.md.
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {},
  },
};

export default config;
