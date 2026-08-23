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
  SyncStatus,
  TrainingProvenanceRow,
} from "../../../indexer/src/types";
import { AppConfig } from "../types";

/**
 * Typed HTTP client for the indexer's query server (ADR 0014). Every
 * function here is a direct GET against one of that server's routes —
 * no client-side aggregation, no re-derivation of anything the indexer
 * already computed. Read-only, by construction: there is no function
 * in this file that performs a write.
 *
 * `uint256`/`uint64` fields cross the HTTP boundary as decimal
 * strings (indexer/src/server.ts's own convention, to avoid precision
 * loss); this module revives the known bigint-valued fields back into
 * real `bigint`s immediately on receipt, so the rest of the app works
 * with the same types `indexer/src/types.ts` and `sdk/src/types.ts`
 * already define — never a parallel, string-based shadow type system.
 */

const BIGINT_FIELDS = new Set(["stake", "challengeBond", "amount", "epoch"]);

function reviveBigints(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reviveBigints);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (BIGINT_FIELDS.has(k) && (typeof v === "string" || v === null)) {
        out[k] = v === null ? null : BigInt(v);
      } else {
        out[k] = reviveBigints(v);
      }
    }
    return out;
  }
  return value;
}

export class IndexerUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`Indexer is unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "IndexerUnavailableError";
  }
}

async function get<T>(baseUrl: string, path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`);
  } catch (err) {
    throw new IndexerUnavailableError(err);
  }
  if (res.status === 404) return null as T;
  if (!res.ok) throw new Error(`Indexer request failed (${res.status}): ${path}`);
  const json = await res.json();
  return reviveBigints(json) as T;
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
// A type alias, not an interface — TS only infers the implicit index
// signature `qs()` needs (Record<string, ...>) for type aliases /
// object literals, not for named interfaces, even though the shapes
// are otherwise identical.
export type PageOpts = {
  limit?: number;
  cursor?: string;
};

export class IndexerClient {
  constructor(private readonly config: AppConfig) {}

  private get baseUrl() {
    return this.config.indexerUrl;
  }

  getSyncStatus(): Promise<SyncStatus> {
    return get(this.baseUrl, "/sync-status");
  }
  listModels(opts: PageOpts = {}): Promise<Page<ModelRow>> {
    return get(this.baseUrl, `/models${qs(opts)}`);
  }
  getModel(modelId: string): Promise<ModelRow | null> {
    return get(this.baseUrl, `/models/${modelId}`);
  }
  getModelLineage(modelId: string): Promise<{ parents: EdgeRow[]; children: EdgeRow[] }> {
    return get(this.baseUrl, `/models/${modelId}/lineage`);
  }
  listModelsByOwner(owner: string, opts: PageOpts = {}): Promise<Page<ModelRow>> {
    return get(this.baseUrl, `/models/owner/${owner}${qs(opts)}`);
  }
  getEdge(edgeId: string): Promise<EdgeRow | null> {
    return get(this.baseUrl, `/edges/${edgeId}`);
  }
  getProvider(address: string): Promise<ProviderSummary> {
    return get(this.baseUrl, `/providers/${address}`);
  }
  getProviderSigners(address: string): Promise<SignerRow[]> {
    return get(this.baseUrl, `/providers/${address}/signers`);
  }
  listExecutionsByProvider(address: string, opts: PageOpts = {}): Promise<Page<ExecutionRow>> {
    return get(this.baseUrl, `/providers/${address}/executions${qs(opts)}`);
  }
  getTrainingProvenance(modelId: string): Promise<TrainingProvenanceRow | null> {
    return get(this.baseUrl, `/provenance/${modelId}`);
  }
  getExecution(executionId: string): Promise<ExecutionRow | null> {
    return get(this.baseUrl, `/executions/${executionId}`);
  }
  getExecutionAttribution(executionId: string): Promise<{ edgeAttributions: EdgeAttributionRow[]; ownerCredits: OwnerCreditRow[] }> {
    return get(this.baseUrl, `/executions/${executionId}/attribution`);
  }
  listExecutionsByModel(modelId: string, opts: PageOpts = {}): Promise<Page<ExecutionRow>> {
    return get(this.baseUrl, `/executions/model/${modelId}${qs(opts)}`);
  }
  getClaimable(address: string): Promise<bigint> {
    return get<string>(this.baseUrl, `/claimable/${address}`).then((v) => BigInt(v));
  }
  getClaims(address: string): Promise<ClaimRow[]> {
    return get(this.baseUrl, `/claims/${address}`);
  }
  getEvents(opts: {
    contract?: string;
    eventName?: string;
    fromBlock?: number;
    toBlock?: number;
    limit?: number;
    cursor?: string;
  } = {}): Promise<Page<StoredEventRow>> {
    return get(this.baseUrl, `/events${qs(opts)}`);
  }
}
