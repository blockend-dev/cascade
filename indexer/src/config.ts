import { CascadeAddresses } from "../../sdk/src/types";

/**
 * Everything the indexer needs to know to sync one Cascade deployment.
 * No hardcoded network assumptions — matches relayer/src/config.ts and
 * sdk/src/client.ts's own explicit-configuration convention rather than
 * baking in a specific chain.
 */
export interface IndexerConfig {
  rpcUrl: string;
  chainId: bigint;
  addresses: CascadeAddresses;
  /** Path to the SQLite database file, or ":memory:" for an ephemeral
   *  in-process database (used by every test in this repository, so a
   *  test run never leaves a stray file behind). */
  dbPath: string;
  /** The first block that could possibly contain a Cascade event —
   *  normally the block CascadeRegistry was deployed in. Backfill never
   *  looks earlier than this. */
  startBlock: number;
  /** Blocks to hold back from the chain's live head before ingesting —
   *  the first line of reorg defense (ADR 0013). */
  confirmations: number;
  /** Max block range per eth_getLogs call. */
  chunkBlocks: number;
}

export function defaultConfig(overrides: Partial<IndexerConfig> & Pick<IndexerConfig, "addresses">): IndexerConfig {
  return {
    rpcUrl: "unused-in-tests",
    chainId: 31337n,
    dbPath: ":memory:",
    startBlock: 0,
    confirmations: 5,
    chunkBlocks: 2000,
    ...overrides,
  };
}
