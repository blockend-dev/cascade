import { openDb } from "../../../indexer/src/db";
import { defaultConfig } from "../../../indexer/src/config";
import { createIndexer, CascadeIndexer } from "../../../indexer/src/sync";
import { startIndexerServer } from "../../../indexer/src/server";
import { IndexerClient } from "../../../web/src/api/indexerClient";
import { AppConfig } from "../../../web/src/types";
import { ethers } from "hardhat";
import { deployCascadeStack } from "../sdk/helpers";
import * as http from "node:http";

export { deployCascadeStack, randomHash } from "../sdk/helpers";

type CascadeStack = Awaited<ReturnType<typeof deployCascadeStack>>;

/**
 * Builds a fresh db + indexer + HTTP query server + IndexerClient for
 * one test, given an already-deployed contract stack. Deliberately NOT
 * bundled into a `loadFixture`-cached fixture together with the
 * deployment — same reasoning as contracts/test/indexer/helpers.ts's
 * `freshIndexer`: `loadFixture` only snapshots/restores EVM state, not
 * a `node:sqlite` database or an `http.Server`, so sharing one across
 * multiple `it()` blocks would leak state (and, worse here, mean every
 * test after the first tries to fetch against a server the first
 * test's own cleanup already closed).
 */
export async function freshDataLayer(stack: CascadeStack): Promise<{
  indexer: CascadeIndexer;
  server: http.Server;
  client: IndexerClient;
  appConfig: AppConfig;
  close: () => void;
}> {
  const db = openDb(":memory:");
  const config = defaultConfig({ addresses: stack.addresses, confirmations: 0, chunkBlocks: 2000, startBlock: 0 });
  const indexer = createIndexer(db, ethers.provider, config);

  // Port 0 — let the OS assign a free ephemeral port, so tests never
  // collide on a shared/derived port number.
  const server = startIndexerServer(db, () => indexer, 0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const appConfig: AppConfig = {
    rpcUrl: "unused",
    chainId: 31337n,
    chainName: "Hardhat",
    indexerUrl: `http://127.0.0.1:${port}`,
    addresses: stack.addresses,
    explorerBaseUrl: null,
  };
  const client = new IndexerClient(appConfig);

  return { indexer, server, client, appConfig, close: () => server.close() };
}
