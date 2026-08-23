import { ethers } from "hardhat";
import { DatabaseSync } from "node:sqlite";
import { openDb } from "../../../indexer/src/db";
import { defaultConfig, IndexerConfig } from "../../../indexer/src/config";
import { createIndexer, CascadeIndexer } from "../../../indexer/src/sync";
import { CascadeAddresses } from "../../../sdk/src/types";
import { deployCascadeStack } from "../sdk/helpers";

export { deployCascadeStack, randomHash } from "../sdk/helpers";

export function openTestDb(): DatabaseSync {
  return openDb(":memory:");
}

/** confirmations: 0 by default — Hardhat's local network auto-mines one
 *  block per transaction, so a nonzero confirmation cushion would just
 *  mean manually mining filler blocks in every test that needs to see
 *  its own just-submitted events. Confirmation-depth behavior itself is
 *  covered by a dedicated, narrower test (sync.test.ts) rather than
 *  threaded through every other test in this suite. */
export function testConfig(overrides: Partial<IndexerConfig> & Pick<IndexerConfig, "addresses">) {
  return defaultConfig({ confirmations: 0, chunkBlocks: 2000, startBlock: 0, ...overrides });
}

/**
 * Creates a brand-new, isolated in-memory database and indexer.
 *
 * Deliberately NOT bundled into a `loadFixture`-cached fixture function
 * together with the contract deployment: `loadFixture` snapshots and
 * restores *EVM* state between tests (cheap, correct, the pattern every
 * other package in this repository already relies on), but it has no
 * knowledge of a plain JS object like a `node:sqlite` `DatabaseSync` —
 * reusing one cached fixture return value across multiple `it()` blocks
 * would silently leak one test's indexed rows into the next test's
 * (already-EVM-reverted, but not DB-reverted) database. Every test in
 * this suite therefore calls `loadFixture(deployCascadeStack-wrapping
 * fixture)` for the contract deployment only, then calls this function
 * directly (uncached) to get its own fresh database.
 */
export function freshIndexer(addresses: CascadeAddresses, overrides: Partial<IndexerConfig> = {}): { db: DatabaseSync; indexer: CascadeIndexer } {
  const db = openTestDb();
  const config = testConfig({ addresses, ...overrides });
  const indexer = createIndexer(db, ethers.provider, config);
  return { db, indexer };
}
