import { ethers } from "ethers";
import { openDb } from "../src/db";
import { defaultConfig } from "../src/config";
import { createIndexer } from "../src/sync";
import * as query from "../src/query";

/**
 * One-off verification: syncs a fresh indexer database against the real
 * deployed mainnet contracts and confirms the just-registered demo
 * model appears in its projection — proof the indexer pipeline works
 * against real chain data, not just Hardhat's local network.
 */

const MODEL_ID = process.argv[2];
if (!MODEL_ID) {
  console.error("Usage: verify-mainnet-sync.ts <modelId>");
  process.exit(1);
}

const ADDRESSES = {
  cascadeRegistry: "0x74F13b00B8e691f5c3794B803b80032Aa268b25b",
  executionRegistry: "0x27Ec35689323624f209F5B19b53Ee4d07D77767d",
  attributionSettlement: "0xA5eFE05E7d20B814e3C0B138a518277E876f2647",
  trainingProvenanceRegistry: "0x383D962Bf9fCB34AB4910B9cC54695c52EB7e635",
};

async function main() {
  const rpcUrl = process.env.RPC_URL || "https://evmrpc.0g.ai";
  const provider = new ethers.JsonRpcProvider(rpcUrl, 16661, { staticNetwork: true });

  // ":memory:" — this session's UNC-mounted dev filesystem cannot
  // reliably hold a WAL-mode SQLite file (confirmed: a real file path
  // here fails with "database is locked" even freshly created, the
  // same class of environment-only limitation already documented for
  // Vite/esbuild and native-module builds on this filesystem). A real
  // OS filesystem does not have this problem — this is a dev-machine
  // constraint, not a code defect. See the final report.
  const dbPath = ":memory:";
  const db = openDb(dbPath);
  const config = defaultConfig({
    addresses: ADDRESSES,
    rpcUrl,
    chainId: 16661n,
    dbPath,
    startBlock: 42518150,
    confirmations: 3,
    chunkBlocks: 2000,
  });
  const indexer = createIndexer(db, provider, config);

  console.log("Syncing indexer against real 0G mainnet...");
  const result = await indexer.syncToHead();
  console.log("Sync result:", JSON.stringify(result));

  const status = await indexer.getSyncStatus();
  console.log("Sync status:", JSON.stringify({ ...status, chainId: status.chainId.toString() }));

  const model = query.getModel(db, MODEL_ID);
  console.log("\n=== INDEXED MODEL PROJECTION ===");
  console.log(model ? JSON.stringify(model, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) : "NOT FOUND");

  const list = query.listModels(db, { limit: 10 });
  console.log("\nModels visible in indexer (up to 10):", list.items.map((m) => m.modelId));
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
});
