import { DatabaseSync } from "node:sqlite";
import {
  ClaimRow,
  EdgeAttributionRow,
  EdgeRow,
  ExecutionRow,
  ModelRow,
  OwnerCreditRow,
  ProviderSummary,
  SignerRow,
  StoredEventRow,
  TrainingProvenanceRow,
} from "./types";

/**
 * QUERY — read-only access to indexed state. Every function here is a
 * thin, direct SQL read; none of them fall back to a live contract call
 * (that would blur the "indexer is a cache, not an authority" line —
 * docs/indexer.md §9). Pagination is a cursor over the row's own
 * canonical-order columns, never SQLite's physical row order.
 */

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;

function toModelRow(r: Record<string, unknown>): ModelRow {
  return {
    modelId: r.model_id as string,
    owner: r.owner as string,
    modelCommitment: r.model_commitment as string,
    metadataURI: r.metadata_uri as string,
    status: r.status as ModelRow["status"],
    createdAtBlock: Number(r.created_at_block),
    createdAtTimestamp: Number(r.created_at_timestamp),
  };
}

function toEdgeRow(r: Record<string, unknown>): EdgeRow {
  return {
    edgeId: r.edge_id as string,
    childModelId: r.child_model_id as string,
    parentModelId: r.parent_model_id as string,
    confidenceLevel: Number(r.confidence_level),
    royaltyBps: Number(r.royalty_bps),
    stake: BigInt(r.stake as string),
    status: r.status as EdgeRow["status"],
    challenger: (r.challenger as string | null) ?? null,
    challengeBond: r.challenge_bond ? BigInt(r.challenge_bond as string) : null,
    registeredAtBlock: Number(r.registered_at_block),
  };
}

export function getModel(db: DatabaseSync, modelId: string): ModelRow | null {
  const row = db.prepare(`SELECT * FROM models WHERE model_id = ?`).get(modelId) as Record<string, unknown> | undefined;
  return row ? toModelRow(row) : null;
}

export function listModels(db: DatabaseSync, opts: { limit?: number; cursor?: string } = {}): Page<ModelRow> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : { block: -1, log: -1 };
  const rows = db
    .prepare(
      `SELECT * FROM models
       WHERE (created_at_block, first_seen_log_index) > (?, ?)
       ORDER BY created_at_block ASC, first_seen_log_index ASC
       LIMIT ?`
    )
    .all(cursor.block, cursor.log, limit + 1) as Array<Record<string, unknown>>;
  return paginate(rows, limit, (r) => [Number(r.created_at_block), Number(r.first_seen_log_index)], toModelRow);
}

export function getEdge(db: DatabaseSync, edgeId: string): EdgeRow | null {
  const row = db.prepare(`SELECT * FROM edges WHERE edge_id = ?`).get(edgeId) as Record<string, unknown> | undefined;
  return row ? toEdgeRow(row) : null;
}

export function getParents(db: DatabaseSync, modelId: string): EdgeRow[] {
  const rows = db
    .prepare(`SELECT * FROM edges WHERE child_model_id = ? ORDER BY registered_at_block ASC, first_seen_log_index ASC`)
    .all(modelId) as Array<Record<string, unknown>>;
  return rows.map(toEdgeRow);
}

export function getChildren(db: DatabaseSync, modelId: string): EdgeRow[] {
  const rows = db
    .prepare(`SELECT * FROM edges WHERE parent_model_id = ? ORDER BY registered_at_block ASC, first_seen_log_index ASC`)
    .all(modelId) as Array<Record<string, unknown>>;
  return rows.map(toEdgeRow);
}

export function getModelLineage(db: DatabaseSync, modelId: string): { parents: EdgeRow[]; children: EdgeRow[] } {
  return { parents: getParents(db, modelId), children: getChildren(db, modelId) };
}

export function getProvider(db: DatabaseSync, provider: string): ProviderSummary {
  const modeRow = db.prepare(`SELECT mode FROM provider_modes WHERE provider = ?`).get(provider) as
    | { mode: number }
    | undefined;
  const countRow = db
    .prepare(`SELECT COUNT(*) as n FROM signers WHERE provider = ? AND active = 1`)
    .get(provider) as { n: number };
  return { provider, mode: modeRow ? Number(modeRow.mode) : null, signerCount: Number(countRow.n) };
}

export function getProviderSigners(db: DatabaseSync, provider: string): SignerRow[] {
  const rows = db
    .prepare(`SELECT * FROM signers WHERE provider = ? ORDER BY signer ASC`)
    .all(provider) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    signer: r.signer as string,
    provider: (r.provider as string | null) ?? null,
    active: Boolean(r.active),
  }));
}

export function getTrainingProvenance(db: DatabaseSync, modelId: string): TrainingProvenanceRow | null {
  const row = db.prepare(`SELECT * FROM training_provenance WHERE child_model_id = ?`).get(modelId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    childModelId: row.child_model_id as string,
    baseModelId: row.base_model_id as string,
    provider: row.provider as string,
    registrant: row.registrant as string,
    commitment: row.commitment as string,
    taskId: row.task_id as string,
    registeredAtBlock: Number(row.registered_at_block),
  };
}

export function getExecution(db: DatabaseSync, executionId: string): ExecutionRow | null {
  const row = db.prepare(`SELECT * FROM executions WHERE execution_id = ?`).get(executionId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  return {
    executionId: row.execution_id as string,
    provider: (row.provider as string | null) ?? null,
    modelId: (row.model_id as string | null) ?? null,
    requestHash: (row.request_hash as string | null) ?? null,
    epoch: row.epoch ? BigInt(row.epoch as string) : null,
    amount: row.amount ? BigInt(row.amount as string) : null,
    servingConfidence: row.serving_confidence === null || row.serving_confidence === undefined ? null : Number(row.serving_confidence),
    consumedAtBlock: row.consumed_at_block === null ? null : Number(row.consumed_at_block),
    settledAtBlock: row.settled_at_block === null ? null : Number(row.settled_at_block),
  };
}

export function getExecutionAttribution(
  db: DatabaseSync,
  executionId: string
): { edgeAttributions: EdgeAttributionRow[]; ownerCredits: OwnerCreditRow[] } {
  const edgeRows = db
    .prepare(`SELECT * FROM edge_attributions WHERE execution_id = ? ORDER BY log_index ASC`)
    .all(executionId) as Array<Record<string, unknown>>;
  const ownerRows = db
    .prepare(`SELECT * FROM owner_credits WHERE execution_id = ? ORDER BY log_index ASC`)
    .all(executionId) as Array<Record<string, unknown>>;
  return {
    edgeAttributions: edgeRows.map((r) => ({
      executionId: r.execution_id as string,
      edgeId: r.edge_id as string,
      childModelId: r.child_model_id as string,
      parentModelId: r.parent_model_id as string,
      amount: BigInt(r.amount as string),
      effectiveConfidence: Number(r.effective_confidence),
    })),
    ownerCredits: ownerRows.map((r) => ({
      executionId: r.execution_id as string,
      modelId: r.model_id as string,
      owner: r.owner as string,
      amount: BigInt(r.amount as string),
    })),
  };
}

export function getClaimable(db: DatabaseSync, owner: string): bigint {
  const row = db.prepare(`SELECT amount FROM claimable_balances WHERE owner = ?`).get(owner) as
    | { amount: string }
    | undefined;
  return row ? BigInt(row.amount) : 0n;
}

export function getClaims(db: DatabaseSync, owner: string): ClaimRow[] {
  const rows = db
    .prepare(`SELECT * FROM claims WHERE recipient = ? ORDER BY block_number ASC, log_index ASC`)
    .all(owner) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    recipient: r.recipient as string,
    amount: BigInt(r.amount as string),
    blockNumber: Number(r.block_number),
    transactionHash: r.transaction_hash as string,
  }));
}

export function getEvents(
  db: DatabaseSync,
  opts: { contractAddress?: string; eventName?: string; fromBlock?: number; toBlock?: number; limit?: number; cursor?: string } = {}
): Page<StoredEventRow> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : { block: opts.fromBlock ?? -1, log: -1 };

  const conditions: string[] = [`(block_number, log_index) > (?, ?)`];
  const params: Array<number | string> = [cursor.block, cursor.log];
  if (opts.contractAddress) {
    conditions.push(`contract_address = ?`);
    params.push(opts.contractAddress);
  }
  if (opts.eventName) {
    conditions.push(`event_name = ?`);
    params.push(opts.eventName);
  }
  if (opts.toBlock !== undefined) {
    conditions.push(`block_number <= ?`);
    params.push(opts.toBlock);
  }

  const rows = db
    .prepare(
      `SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY block_number ASC, log_index ASC LIMIT ?`
    )
    .all(...params, limit + 1) as Array<Record<string, unknown>>;

  return paginate(
    rows,
    limit,
    (r) => [Number(r.block_number), Number(r.log_index)],
    (r) => ({
      chainId: BigInt(r.chain_id as string),
      contractAddress: r.contract_address as string,
      eventName: r.event_name as string,
      blockNumber: Number(r.block_number),
      blockHash: r.block_hash as string,
      blockTimestamp: Number(r.block_timestamp),
      transactionHash: r.transaction_hash as string,
      transactionIndex: r.transaction_index === null ? null : Number(r.transaction_index),
      logIndex: Number(r.log_index),
      payload: JSON.parse(r.payload_json as string),
    })
  );
}

// --- pagination helpers -------------------------------------------------

function encodeCursor(block: number, log: number): string {
  return Buffer.from(`${block}:${log}`, "utf-8").toString("base64url");
}

function decodeCursor(cursor: string): { block: number; log: number } {
  const [block, log] = Buffer.from(cursor, "base64url").toString("utf-8").split(":").map(Number);
  return { block, log };
}

function paginate<Raw extends Record<string, unknown>, T>(
  rows: Raw[],
  limit: number,
  cursorFields: (r: Raw) => [number, number],
  map: (r: Raw) => T
): Page<T> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const items = page.map(map);
  const nextCursor = hasMore ? encodeCursor(...cursorFields(page[page.length - 1])) : null;
  return { items, nextCursor };
}
