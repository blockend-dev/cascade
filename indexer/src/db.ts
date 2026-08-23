import { DatabaseSync } from "node:sqlite";

/**
 * The one file in this package that touches `node:sqlite` directly (ADR
 * 0013). Everything else goes through this module's `Db` wrapper, so a
 * future driver swap (should the experimental API ever need replacing)
 * is a one-file change.
 *
 * Schema notes:
 *  - `uint256`/`uint64` chain values are TEXT (decimal-string bigints),
 *    never INTEGER — SQLite's INTEGER is a signed 64-bit type that would
 *    silently lose precision above Number.MAX_SAFE_INTEGER for large wei
 *    amounts. Only genuinely bounded values (block numbers, log
 *    indexes, bps, enum-backed status ints) are INTEGER.
 *  - `events` is the canonical, append-only, provenance-preserving log.
 *    Every projection table below is fully derivable from it alone —
 *    see docs/indexer.md §6/§8 (backfill, resync, and reorg rollback all
 *    share this property).
 */
export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  applySchema(db);
  return db;
}

function applySchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      chain_id TEXT PRIMARY KEY,
      last_block_number INTEGER,
      last_block_hash TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chain_id TEXT NOT NULL,
      contract_address TEXT NOT NULL,
      event_name TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      block_hash TEXT NOT NULL,
      block_timestamp INTEGER NOT NULL,
      transaction_hash TEXT NOT NULL,
      transaction_index INTEGER,
      log_index INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      ingested_at TEXT NOT NULL,
      UNIQUE (chain_id, block_hash, log_index)
    );
    CREATE INDEX IF NOT EXISTS idx_events_block ON events(block_number, log_index);
    CREATE INDEX IF NOT EXISTS idx_events_contract_name ON events(contract_address, event_name);

    CREATE TABLE IF NOT EXISTS models (
      model_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      model_commitment TEXT NOT NULL,
      metadata_uri TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at_block INTEGER NOT NULL,
      created_at_timestamp INTEGER NOT NULL,
      first_seen_log_index INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_models_owner ON models(owner);

    CREATE TABLE IF NOT EXISTS edges (
      edge_id TEXT PRIMARY KEY,
      child_model_id TEXT NOT NULL,
      parent_model_id TEXT NOT NULL,
      confidence_level INTEGER NOT NULL,
      royalty_bps INTEGER NOT NULL,
      stake TEXT NOT NULL,
      status TEXT NOT NULL,
      challenger TEXT,
      challenge_bond TEXT,
      registered_at_block INTEGER NOT NULL,
      first_seen_log_index INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_edges_child ON edges(child_model_id);
    CREATE INDEX IF NOT EXISTS idx_edges_parent ON edges(parent_model_id);

    CREATE TABLE IF NOT EXISTS signers (
      signer TEXT PRIMARY KEY,
      provider TEXT,
      active INTEGER NOT NULL,
      updated_at_block INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_signers_provider ON signers(provider);

    CREATE TABLE IF NOT EXISTS provider_modes (
      provider TEXT PRIMARY KEY,
      mode INTEGER NOT NULL,
      updated_at_block INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS training_provenance (
      child_model_id TEXT PRIMARY KEY,
      base_model_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      registrant TEXT NOT NULL,
      commitment TEXT NOT NULL,
      task_id TEXT NOT NULL,
      registered_at_block INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS executions (
      execution_id TEXT PRIMARY KEY,
      provider TEXT,
      model_id TEXT,
      request_hash TEXT,
      epoch TEXT,
      amount TEXT,
      serving_confidence INTEGER,
      consumed_at_block INTEGER,
      settled_at_block INTEGER,
      consumed_tx_hash TEXT,
      settled_tx_hash TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_executions_model ON executions(model_id);
    CREATE INDEX IF NOT EXISTS idx_executions_provider ON executions(provider);

    CREATE TABLE IF NOT EXISTS edge_attributions (
      execution_id TEXT NOT NULL,
      edge_id TEXT NOT NULL,
      child_model_id TEXT NOT NULL,
      parent_model_id TEXT NOT NULL,
      amount TEXT NOT NULL,
      effective_confidence INTEGER NOT NULL,
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      PRIMARY KEY (execution_id, edge_id)
    );

    CREATE TABLE IF NOT EXISTS owner_credits (
      execution_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      amount TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      PRIMARY KEY (execution_id, model_id)
    );
    CREATE INDEX IF NOT EXISTS idx_owner_credits_owner ON owner_credits(owner);

    CREATE TABLE IF NOT EXISTS claimable_balances (
      owner TEXT PRIMARY KEY,
      amount TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claims (
      recipient TEXT NOT NULL,
      amount TEXT NOT NULL,
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      transaction_hash TEXT NOT NULL,
      PRIMARY KEY (recipient, block_number, log_index)
    );
    CREATE INDEX IF NOT EXISTS idx_claims_recipient ON claims(recipient);
  `);
}

/** All table names that hold *derived* projection state — i.e.
 *  everything except `events` (the canonical source) and `sync_state`
 *  (sync bookkeeping, not projection). Used by resync/rollback to wipe
 *  and rebuild in one place rather than listing tables in two places
 *  that could drift apart. */
export const PROJECTION_TABLES = [
  "models",
  "edges",
  "signers",
  "provider_modes",
  "training_provenance",
  "executions",
  "edge_attributions",
  "owner_credits",
  "claimable_balances",
  "claims",
] as const;

export function clearProjections(db: DatabaseSync): void {
  const tx = db.exec.bind(db);
  for (const table of PROJECTION_TABLES) {
    tx(`DELETE FROM ${table};`);
  }
}
