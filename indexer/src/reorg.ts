import { DatabaseSync } from "node:sqlite";
import { ethers } from "ethers";
import { clearProjections } from "./db";
import { applyProjection } from "./projection";
import { parseJson } from "./serialize";
import { CanonicalEvent } from "./types";

/**
 * Reorg detection and recovery — see ADR 0013 for the full reasoning.
 * Two-tier design: a cheap O(1) tip-hash check every tick (this
 * module's `tipHasReorged`), and — only when that check actually fires
 * — a walk back through the distinct block hashes already recorded on
 * stored events to find the last still-canonical block, followed by a
 * full projection rebuild from whatever events survive
 * (`recoverFromReorg`). No separate per-block checkpoint table: the
 * `events` table's own `(block_number, block_hash)` provenance is reused
 * rather than duplicated.
 */

export interface SyncStateRow {
  lastBlockNumber: number;
  lastBlockHash: string;
}

export function readSyncState(db: DatabaseSync, chainId: bigint): SyncStateRow | null {
  const row = db
    .prepare(`SELECT last_block_number, last_block_hash FROM sync_state WHERE chain_id = ?`)
    .get(chainId.toString()) as { last_block_number: number | null; last_block_hash: string | null } | undefined;
  if (!row || row.last_block_number === null || row.last_block_hash === null) return null;
  return { lastBlockNumber: row.last_block_number, lastBlockHash: row.last_block_hash };
}

export function writeSyncState(db: DatabaseSync, chainId: bigint, blockNumber: number, blockHash: string): void {
  db.prepare(
    `INSERT INTO sync_state (chain_id, last_block_number, last_block_hash, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(chain_id) DO UPDATE SET last_block_number = excluded.last_block_number, last_block_hash = excluded.last_block_hash, updated_at = excluded.updated_at`
  ).run(chainId.toString(), blockNumber, blockHash, new Date().toISOString());
}

function clearSyncState(db: DatabaseSync, chainId: bigint): void {
  db.prepare(`DELETE FROM sync_state WHERE chain_id = ?`).run(chainId.toString());
}

/** The cheap common-case check: does the chain still agree with the
 *  hash we recorded for the last block we ingested? */
export async function tipHasReorged(provider: ethers.Provider, state: SyncStateRow): Promise<boolean> {
  const liveBlock = await provider.getBlock(state.lastBlockNumber);
  if (!liveBlock) return true; // block no longer retrievable at that number — treat as reorged, be conservative
  return liveBlock.hash !== state.lastBlockHash;
}

/**
 * Rebuilds every projection table from the `events` table's current
 * contents, in canonical order. Used identically by `resync
 * --from-genesis` and by reorg recovery's rollback — see ADR 0013 for
 * why sharing this one code path is deliberate.
 */
export function rebuildProjections(db: DatabaseSync): void {
  clearProjections(db);
  const rows = db
    .prepare(
      `SELECT chain_id, contract_address, event_name, block_number, block_hash, block_timestamp,
              transaction_hash, transaction_index, log_index, payload_json
       FROM events ORDER BY block_number ASC, log_index ASC`
    )
    .all() as Array<{
    chain_id: string;
    contract_address: string;
    event_name: string;
    block_number: number;
    block_hash: string;
    block_timestamp: number;
    transaction_hash: string;
    transaction_index: number | null;
    log_index: number;
    payload_json: string;
  }>;

  for (const row of rows) {
    const event = {
      chainId: BigInt(row.chain_id),
      contractAddress: row.contract_address,
      eventName: row.event_name,
      blockNumber: row.block_number,
      blockHash: row.block_hash,
      blockTimestamp: row.block_timestamp,
      transactionHash: row.transaction_hash,
      transactionIndex: row.transaction_index,
      logIndex: row.log_index,
      payload: parseJson(row.payload_json),
    } as CanonicalEvent;
    applyProjection(db, event);
  }
}

/**
 * Walks backward through the distinct `(block_number, block_hash)`
 * pairs already recorded in `events`, re-fetching each live from the
 * RPC, until one still matches — that's the last still-canonical block.
 * Deletes every event at or after the divergence point and rebuilds
 * every projection from what remains.
 *
 * If nothing matches (a reorg deeper than all locally retained
 * history — extreme), falls back to wiping all state entirely so the
 * next sync tick starts a fresh backfill from `startBlock`.
 *
 * Returns the block number sync should resume from (i.e. the new
 * "last ingested block" — the caller's next fetch starts at
 * `resumeFrom + 1`), or `null` if a full wipe occurred.
 */
export async function recoverFromReorg(
  db: DatabaseSync,
  provider: ethers.Provider,
  chainId: bigint
): Promise<number | null> {
  const candidates = db
    .prepare(
      `SELECT DISTINCT block_number, block_hash FROM events WHERE chain_id = ? ORDER BY block_number DESC`
    )
    .all(chainId.toString()) as Array<{ block_number: number; block_hash: string }>;

  for (const candidate of candidates) {
    const liveBlock = await provider.getBlock(candidate.block_number);
    if (liveBlock && liveBlock.hash === candidate.block_hash) {
      // Found the last still-canonical block. Roll everything after it back.
      db.prepare(`DELETE FROM events WHERE chain_id = ? AND block_number > ?`).run(chainId.toString(), candidate.block_number);
      rebuildProjections(db);
      writeSyncState(db, chainId, candidate.block_number, candidate.block_hash);
      return candidate.block_number;
    }
  }

  // No locally retained block is canonical any more — full wipe.
  db.prepare(`DELETE FROM events WHERE chain_id = ?`).run(chainId.toString());
  clearProjections(db);
  clearSyncState(db, chainId);
  return null;
}
