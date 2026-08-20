import { ProofStatus } from "./types";

/**
 * Local, in-memory, per-process bookkeeping — an optimization, never an
 * authority. See docs/relayer.md "Idempotency": on restart this store is
 * empty, and that is correct by design, because every executionId is
 * re-checked against `executionConsumed` on-chain before any action is
 * taken. This store exists only to avoid redundant RPC calls and
 * duplicate log noise within a single process's uptime, not to remember
 * anything that matters economically.
 */
export interface ExecutionRecord {
  executionId: string;
  status: ProofStatus;
  attempts: number;
  lastUpdated: number;
  txHash?: string;
  reason?: string;
}

export class ExecutionStore {
  private readonly records = new Map<string, ExecutionRecord>();

  get(executionId: string): ExecutionRecord | undefined {
    return this.records.get(executionId);
  }

  /** True only if this process has already observed a terminal, settled
   *  outcome for this execution — a pure short-circuit to skip redundant
   *  work. Never used to decide correctness; the chain read always wins
   *  when this returns false or is unknown. */
  isKnownSettled(executionId: string): boolean {
    const record = this.records.get(executionId);
    return record?.status === ProofStatus.SETTLED || record?.status === ProofStatus.DUPLICATE;
  }

  upsert(executionId: string, patch: Partial<Omit<ExecutionRecord, "executionId">>): ExecutionRecord {
    const existing = this.records.get(executionId);
    const record: ExecutionRecord = {
      executionId,
      status: patch.status ?? existing?.status ?? ProofStatus.DISCOVERED,
      attempts: patch.attempts ?? existing?.attempts ?? 0,
      lastUpdated: Date.now(),
      txHash: patch.txHash ?? existing?.txHash,
      reason: patch.reason ?? existing?.reason,
    };
    this.records.set(executionId, record);
    return record;
  }

  size(): number {
    return this.records.size;
  }
}
