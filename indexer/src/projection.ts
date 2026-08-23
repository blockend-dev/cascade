import { DatabaseSync } from "node:sqlite";
import { CanonicalEvent } from "./types";
import { serializeJson } from "./serialize";

/**
 * Applies canonical events to indexed state. Every function here is a
 * pure upsert keyed by the projection table's own primary key, so
 * calling it twice with the same event is a no-op the second time —
 * except `OwnerCredited`'s `claimable_balances` increment, which is
 * NOT naturally idempotent (it's a running sum) and is explicitly
 * guarded below; see that function's comment.
 *
 * Nothing here re-derives an amount, a recipient, an execution
 * identity, or a confidence level — every value written is copied
 * directly from the event payload the contract itself emitted
 * (docs/indexer.md §2, category A).
 */

/** Inserts one canonical event into the append-only `events` table.
 *  Returns whether a new row was actually added (`false` for a
 *  duplicate — the whole point of the `UNIQUE(chain_id, block_hash,
 *  log_index)` constraint, docs/indexer.md §5). */
export function insertEvent(db: DatabaseSync, event: CanonicalEvent): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO events
        (chain_id, contract_address, event_name, block_number, block_hash, block_timestamp,
         transaction_hash, transaction_index, log_index, payload_json, ingested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.chainId.toString(),
      event.contractAddress,
      event.eventName,
      event.blockNumber,
      event.blockHash,
      event.blockTimestamp,
      event.transactionHash,
      event.transactionIndex,
      event.logIndex,
      serializeJson(event.payload),
      new Date().toISOString()
    );
  return Number(result.changes) > 0;
}

/** Ingests one event: stores it, and — only if it wasn't already stored
 *  — applies its projection effect. This is the single idempotency
 *  boundary duplicate ingestion, overlapping RPC ranges, and restart
 *  all rely on: an event that's already in the database never touches
 *  a projection table a second time through this path. (Replay, which
 *  intentionally reprocesses the same events against emptied
 *  projection tables, calls `applyProjection` directly instead — see
 *  sync.ts's `rebuildProjections`.) */
export function ingestEvent(db: DatabaseSync, event: CanonicalEvent): void {
  const isNew = insertEvent(db, event);
  if (isNew) applyProjection(db, event);
}

export function applyProjection(db: DatabaseSync, event: CanonicalEvent): void {
  switch (event.eventName) {
    case "ModelRegistered": {
      const p = event.payload;
      db.prepare(
        `INSERT INTO models (model_id, owner, model_commitment, metadata_uri, status, created_at_block, created_at_timestamp, first_seen_log_index)
         VALUES (?, ?, ?, ?, 'Active', ?, ?, ?)
         ON CONFLICT(model_id) DO NOTHING`
      ).run(p.modelId, p.owner, p.modelCommitment, p.metadataURI, event.blockNumber, event.blockTimestamp, event.logIndex);
      return;
    }
    case "ModelMetadataUpdated": {
      const p = event.payload;
      db.prepare(`UPDATE models SET metadata_uri = ? WHERE model_id = ?`).run(p.metadataURI, p.modelId);
      return;
    }
    case "ModelOwnershipTransferred": {
      const p = event.payload;
      db.prepare(`UPDATE models SET owner = ? WHERE model_id = ?`).run(p.newOwner, p.modelId);
      return;
    }
    case "ModelRevoked": {
      const p = event.payload;
      db.prepare(`UPDATE models SET status = 'Revoked' WHERE model_id = ?`).run(p.modelId);
      return;
    }

    case "LineageEdgeRegistered": {
      const p = event.payload;
      db.prepare(
        `INSERT INTO edges (edge_id, child_model_id, parent_model_id, confidence_level, royalty_bps, stake, status, challenger, challenge_bond, registered_at_block, first_seen_log_index)
         VALUES (?, ?, ?, ?, ?, ?, 'Pending', NULL, NULL, ?, ?)
         ON CONFLICT(edge_id) DO NOTHING`
      ).run(
        p.edgeId,
        p.childModelId,
        p.parentModelId,
        p.confidenceLevel,
        p.royaltyBps,
        p.stake.toString(),
        event.blockNumber,
        event.logIndex
      );
      return;
    }
    case "LineageEdgeChallenged": {
      const p = event.payload;
      db.prepare(`UPDATE edges SET status = 'Challenged', challenger = ?, challenge_bond = ? WHERE edge_id = ?`).run(
        p.challenger,
        p.bond.toString(),
        p.edgeId
      );
      return;
    }
    case "LineageEdgeResolved": {
      const p = event.payload;
      db.prepare(`UPDATE edges SET status = ? WHERE edge_id = ?`).run(p.challengeUpheld ? "Rejected" : "Finalized", p.edgeId);
      return;
    }
    case "LineageEdgeFinalized": {
      const p = event.payload;
      // Idempotent by construction — emitted from two call paths for
      // the same transition (docs/indexer.md §1); a plain overwrite to
      // 'Finalized' is correct regardless of which path fired it, and
      // regardless of whether LineageEdgeResolved(false) already set it.
      db.prepare(`UPDATE edges SET status = 'Finalized' WHERE edge_id = ?`).run(p.edgeId);
      return;
    }

    case "SignerRegistered": {
      const p = event.payload;
      db.prepare(
        `INSERT INTO signers (signer, provider, active, updated_at_block) VALUES (?, ?, 1, ?)
         ON CONFLICT(signer) DO UPDATE SET provider = excluded.provider, active = 1, updated_at_block = excluded.updated_at_block`
      ).run(p.signer, p.provider, event.blockNumber);
      return;
    }
    case "SignerRevoked": {
      const p = event.payload;
      db.prepare(
        `INSERT INTO signers (signer, provider, active, updated_at_block) VALUES (?, NULL, 0, ?)
         ON CONFLICT(signer) DO UPDATE SET provider = NULL, active = 0, updated_at_block = excluded.updated_at_block`
      ).run(p.signer, event.blockNumber);
      return;
    }
    case "ProviderModeUpdated": {
      const p = event.payload;
      db.prepare(
        `INSERT INTO provider_modes (provider, mode, updated_at_block) VALUES (?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET mode = excluded.mode, updated_at_block = excluded.updated_at_block`
      ).run(p.provider, p.mode, event.blockNumber);
      return;
    }

    case "ProvenanceRegistered": {
      const p = event.payload;
      db.prepare(
        `INSERT INTO training_provenance (child_model_id, base_model_id, provider, registrant, commitment, task_id, registered_at_block)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(child_model_id) DO NOTHING`
      ).run(p.childModelId, p.baseModelId, p.provider, p.registrant, p.commitment, p.taskId, event.blockNumber);
      return;
    }

    case "UsageProofConsumed": {
      const p = event.payload;
      db.prepare(
        `INSERT INTO executions (execution_id, provider, model_id, request_hash, consumed_at_block, consumed_tx_hash)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(execution_id) DO UPDATE SET
           provider = excluded.provider, model_id = excluded.model_id, request_hash = excluded.request_hash,
           consumed_at_block = excluded.consumed_at_block, consumed_tx_hash = excluded.consumed_tx_hash`
      ).run(p.executionId, p.provider, p.modelId, p.requestHash, event.blockNumber, event.transactionHash);
      return;
    }
    case "ExecutionSettled": {
      const p = event.payload;
      db.prepare(
        `INSERT INTO executions (execution_id, provider, model_id, epoch, amount, serving_confidence, settled_at_block, settled_tx_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(execution_id) DO UPDATE SET
           provider = excluded.provider, model_id = excluded.model_id, epoch = excluded.epoch, amount = excluded.amount,
           serving_confidence = excluded.serving_confidence, settled_at_block = excluded.settled_at_block, settled_tx_hash = excluded.settled_tx_hash`
      ).run(
        p.executionId,
        p.provider,
        p.modelId,
        p.epoch.toString(),
        p.amount.toString(),
        p.servingConfidence,
        event.blockNumber,
        event.transactionHash
      );
      return;
    }
    case "EdgeAttributed": {
      const p = event.payload;
      db.prepare(
        `INSERT INTO edge_attributions (execution_id, edge_id, child_model_id, parent_model_id, amount, effective_confidence, block_number, log_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(execution_id, edge_id) DO NOTHING`
      ).run(p.executionId, p.edgeId, p.childModelId, p.parentModelId, p.amount.toString(), p.effectiveConfidence, event.blockNumber, event.logIndex);
      return;
    }
    case "OwnerCredited": {
      const p = event.payload;
      // NOT naturally idempotent — claimable_balances is a running sum,
      // not an overwrite. Correctness relies on the insert into
      // owner_credits (append-only, keyed by the natural
      // (execution_id, model_id) pair a real settlement can only ever
      // produce once) actually adding a new row; the balance increment
      // only happens when it did. This is the one projection table this
      // package updates via read-modify-write instead of a pure SQL
      // upsert, because SQLite's own INTEGER arithmetic would silently
      // lose precision above 2^63 for large wei amounts — see ADR 0013
      // on why amounts are TEXT decimal strings, handled with `bigint`
      // in application code instead.
      const inserted = db
        .prepare(
          `INSERT INTO owner_credits (execution_id, model_id, owner, amount, block_number, log_index)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(execution_id, model_id) DO NOTHING`
        )
        .run(p.executionId, p.modelId, p.owner, p.amount.toString(), event.blockNumber, event.logIndex);
      if (Number(inserted.changes) === 0) return;

      const row = db.prepare(`SELECT amount FROM claimable_balances WHERE owner = ?`).get(p.owner) as
        | { amount: string }
        | undefined;
      const newBalance = (row ? BigInt(row.amount) : 0n) + p.amount;
      db.prepare(
        `INSERT INTO claimable_balances (owner, amount) VALUES (?, ?)
         ON CONFLICT(owner) DO UPDATE SET amount = excluded.amount`
      ).run(p.owner, newBalance.toString());
      return;
    }
    case "Claimed": {
      const p = event.payload;
      db.prepare(
        `INSERT INTO claimable_balances (owner, amount) VALUES (?, '0')
         ON CONFLICT(owner) DO UPDATE SET amount = '0'`
      ).run(p.recipient);
      db.prepare(
        `INSERT INTO claims (recipient, amount, block_number, log_index, transaction_hash) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(recipient, block_number, log_index) DO NOTHING`
      ).run(p.recipient, p.amount.toString(), event.blockNumber, event.logIndex, event.transactionHash);
      return;
    }

    default: {
      // Exhaustiveness check: if a new event name is ever added to
      // CanonicalEvent without a case here, this fails to compile.
      const _exhaustive: never = event;
      throw new Error(`no projection handler for event: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
