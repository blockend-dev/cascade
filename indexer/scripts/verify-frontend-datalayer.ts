import { ethers } from "ethers";
import { openDb } from "../src/db";
import { defaultConfig } from "../src/config";
import { createIndexer } from "../src/sync";
import { startIndexerServer } from "../src/server";
import { IndexerClient } from "../../web/src/api/indexerClient";

/**
 * Verifies the exact data layer web/'s React UI depends on — the
 * indexer's real HTTP query server (ADR 0014), queried through the
 * same IndexerClient class the frontend's pages actually import
 * (web/src/api/indexerClient.ts). This is what "the frontend reads the
 * live model through the indexer/SDK" can honestly be verified to mean
 * in this environment: the data layer, end to end, over real HTTP —
 * not a rendered browser screenshot, which this dev environment's
 * known Vite/esbuild-on-UNC-path limitation (docs/frontend.md §11)
 * prevents producing here.
 */

const MODEL_ID = process.argv[2];
if (!MODEL_ID) {
  console.error("Usage: verify-frontend-datalayer.ts <modelId>");
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
  const db = openDb(":memory:"); // see verify-mainnet-sync.ts's comment — this environment's UNC filesystem constraint
  const config = defaultConfig({ addresses: ADDRESSES, rpcUrl, chainId: 16661n, startBlock: 42518150, confirmations: 3 });
  const indexer = createIndexer(db, provider, config);
  await indexer.syncToHead();

  const server = startIndexerServer(db, () => indexer, 0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  console.log(`Indexer HTTP server listening on 127.0.0.1:${port}`);

  // Exactly what web/src/config.ts's loadAppConfig() would produce for VITE_INDEXER_URL.
  const client = new IndexerClient({
    rpcUrl,
    chainId: 16661n,
    chainName: "0G Mainnet",
    indexerUrl: `http://127.0.0.1:${port}`,
    addresses: ADDRESSES,
    explorerBaseUrl: "https://chainscan.0g.ai",
  });

  const model = await client.getModel(MODEL_ID);
  console.log("\n=== web/'s IndexerClient.getModel() result, over real HTTP ===");
  console.log(model ? JSON.stringify(model, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) : "NOT FOUND");

  const list = await client.listModels({ limit: 10 });
  console.log("\n=== web/'s IndexerClient.listModels() result ===");
  console.log("items:", list.items.map((m) => m.modelId));

  const syncStatus = await client.getSyncStatus();
  console.log("\n=== web/'s IndexerClient.getSyncStatus() result (the 'Indexed through block N' banner) ===");
  console.log(JSON.stringify(syncStatus, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

  server.close();
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
});
