import { ethers } from "ethers";
import { loadConfigFromEnv } from "./config";
import { openDb } from "./db";
import { createIndexer, CascadeIndexer } from "./sync";
import { startIndexerServer } from "./server";
import { logger } from "./logger";

async function main() {
  const config = loadConfigFromEnv();
  const db = openDb(config.dbPath);
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
  const indexer: CascadeIndexer = createIndexer(db, provider, config);

  const server = startIndexerServer(db, () => indexer, config.httpPort);
  logger.info("indexer_server_started", { port: config.httpPort, dbPath: config.dbPath });

  let stopping = false;
  const tick = async () => {
    if (stopping) return;
    try {
      const result = await indexer.syncToHead();
      if (result.eventsIngested > 0 || result.reorgsRecovered > 0) {
        logger.info("indexer_sync_tick", result);
      }
    } catch (err) {
      logger.error("indexer_sync_failed", { reason: err instanceof Error ? err.message : String(err) });
    }
    if (!stopping) setTimeout(tick, config.pollIntervalMs);
  };
  await tick();

  const shutdown = () => {
    stopping = true;
    logger.info("indexer_stopping", {});
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("indexer_fatal", { reason: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
