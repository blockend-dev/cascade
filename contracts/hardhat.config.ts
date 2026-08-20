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
      // OpenZeppelin's Bytes.sol (pulled in transitively via EIP712/ECDSA)
      // uses MCOPY, a Cancun opcode. 0G Chain's own docs note Cancun
      // compatibility (docs/adr/0002 background) — targeting it here too.
      evmVersion: "cancun",
      // AttributionSettlement's recursive _distribute has enough live
      // locals (6 params + 7 locals across a recursive call) to hit
      // "stack too deep" under the legacy codegen. viaIR is the
      // compiler-recommended fix and is more robust than manually
      // packing params into structs purely to dodge the 16-slot stack.
      viaIR: true,
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
