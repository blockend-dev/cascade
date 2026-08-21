import { ethers } from "ethers";
import { loadConfig } from "./config";
import { verifyAndLoad } from "./lifecycle";
import { StubModelBackend } from "./modelBackend";
import { startServer } from "./server";
import { ZgStorageClient } from "./storage";

function log(event: string, fields: Record<string, unknown> = {}) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

async function main() {
  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl);
  const storage = new ZgStorageClient(config.storageIndexerUrl);
  const backend = new StubModelBackend();

  log("verification_started", { modelId: config.modelId });
  const { modelCommitment } = await verifyAndLoad(config, provider, storage, backend);
  log("verification_succeeded", { modelId: config.modelId, modelCommitment });

  startServer(backend, config.httpPort);
  log("server_started", { port: config.httpPort });
}

main().catch((err) => {
  // Fail closed: any error during startup — model not found, not
  // Active, download/proof verification failed, backend load failed —
  // exits without ever starting the HTTP server. There is no partial or
  // degraded-mode serving path.
  log("startup_failed", { reason: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
