import { ethers } from "ethers";
import { loadConfig } from "./config";
import { HttpUsageProofSource } from "./ingestion";
import { logger } from "./logger";
import { buildRelayer, CascadeRelayer } from "./relayer";
import { createSigner } from "./signer";

async function main() {
  const config = loadConfig();
  const provider = new ethers.JsonRpcProvider(config.rpcUrl, config.chainId);
  const signer = createSigner(config.privateKey, provider);

  const { verifier, submitter } = buildRelayer(config, provider, signer);
  const source = new HttpUsageProofSource(config.httpPort);
  const relayer = new CascadeRelayer(verifier, submitter, source);

  await relayer.start();
  logger.info("relayer_started", {
    address: await signer.getAddress(),
    executionRegistry: config.executionRegistryAddress,
    attributionSettlement: config.attributionSettlementAddress,
  });

  const shutdown = async () => {
    logger.info("relayer_stopping", {});
    await relayer.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.error("relayer_fatal", { reason: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
