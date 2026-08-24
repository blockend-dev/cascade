import { ethers } from "ethers";
import { createCascadeClient } from "../../sdk/src/client";
import { CascadeAddresses } from "../../sdk/src/types";

/**
 * Registers the real, just-uploaded 0G Storage artifact on the deployed
 * mainnet CascadeRegistry, using the SDK's own write path (never a
 * hand-built transaction) — the exact returned Storage rootHash passed
 * straight through as `modelCommitment`, no transformation.
 */

const ROOT_HASH = process.argv[2];
if (!ROOT_HASH) {
  console.error("Usage: register-demo-model.ts <rootHash>");
  process.exit(1);
}

const RPC_URL = process.env.RPC_URL || "https://evmrpc.0g.ai";
const ADDRESSES: CascadeAddresses = {
  cascadeRegistry: "0x74F13b00B8e691f5c3794B803b80032Aa268b25b",
  executionRegistry: "0x27Ec35689323624f209F5B19b53Ee4d07D77767d",
  attributionSettlement: "0xA5eFE05E7d20B814e3C0B138a518277E876f2647",
  trainingProvenanceRegistry: "0x383D962Bf9fCB34AB4910B9cC54695c52EB7e635",
};
const METADATA_URI = `0g-storage://${ROOT_HASH}`;

async function main() {
  const privateKey = process.env.DEMO_PRIVATE_KEY;
  if (!privateKey) throw new Error("DEMO_PRIVATE_KEY not set.");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(privateKey, provider);
  console.log("Registering as:", signer.address);

  const client = createCascadeClient({ provider, signer, addresses: ADDRESSES });

  const { modelId, receipt } = await client.write.registerModel(ROOT_HASH, METADATA_URI);
  console.log("\n=== REGISTRATION RESULT ===");
  console.log("modelId:", modelId);
  console.log("transactionHash:", receipt.hash);
  console.log("blockNumber:", receipt.blockNumber);

  // Independent read-back, not just trusting the write succeeded.
  const model = await client.read.getModel(modelId);
  console.log("\n=== READ-BACK VERIFICATION ===");
  console.log("owner:", model.owner);
  console.log("modelCommitment:", model.modelCommitment);
  console.log("metadataURI:", model.metadataURI);
  console.log("status:", model.status);
  console.log("commitment matches uploaded rootHash exactly:", model.modelCommitment.toLowerCase() === ROOT_HASH.toLowerCase());

  const network = await provider.getNetwork();
  console.log("\nChain ID:", network.chainId.toString());
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
});
