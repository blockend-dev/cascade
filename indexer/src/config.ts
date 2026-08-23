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

/** Everything main.ts needs beyond IndexerConfig — the sync-loop and
 *  HTTP-server operational knobs, kept separate since tests construct
 *  an IndexerConfig directly and never touch these. */
export interface OperationalConfig {
  httpPort: number;
  pollIntervalMs: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} must be a number, got: ${raw}`);
  return parsed;
}

/** Environment-driven configuration for `main.ts` — no secrets or
 *  addresses hardcoded, matching relayer/src/config.ts's own
 *  convention exactly (see indexer/.env.example for the documented
 *  variable list). */
export function loadConfigFromEnv(): IndexerConfig & OperationalConfig {
  return {
    rpcUrl: requireEnv("RPC_URL"),
    chainId: BigInt(envInt("CHAIN_ID", 31337)),
    addresses: {
      cascadeRegistry: requireEnv("CASCADE_REGISTRY_ADDRESS"),
      executionRegistry: requireEnv("EXECUTION_REGISTRY_ADDRESS"),
      attributionSettlement: requireEnv("ATTRIBUTION_SETTLEMENT_ADDRESS"),
      trainingProvenanceRegistry: requireEnv("TRAINING_PROVENANCE_REGISTRY_ADDRESS"),
    },
    dbPath: process.env.DB_PATH || "./cascade-index.sqlite",
    startBlock: envInt("START_BLOCK", 0),
    confirmations: envInt("CONFIRMATIONS", 5),
    chunkBlocks: envInt("CHUNK_BLOCKS", 2000),
    httpPort: envInt("HTTP_PORT", 8788),
    pollIntervalMs: envInt("POLL_INTERVAL_MS", 5000),
  };
}
