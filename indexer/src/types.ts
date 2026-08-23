import { ConfidenceLevel } from "../../sdk/src/types";

/**
 * Canonical event payloads — one shape per event actually emitted by the
 * four Cascade contracts (docs/indexer.md §1). Field sets mirror the
 * event declarations exactly; nothing here adds a field the contract
 * doesn't emit. `bigint`-valued chain fields stay `bigint` at this layer
 * (converted to decimal-string TEXT only at the SQLite boundary — see
 * db.ts / projection.ts). Confidence-valued fields reuse the SDK's
 * `ConfidenceLevel` enum rather than a plain `number` — the same
 * canonical type `sdk/` and `web/` already use, so a caller never needs
 * to assert one on.
 */

export interface EventEnvelope<Name extends string, Payload> {
  chainId: bigint;
  contractAddress: string;
  eventName: Name;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
  transactionHash: string;
  transactionIndex: number | null;
  logIndex: number;
  payload: Payload;
}

// --- CascadeRegistry -------------------------------------------------

export interface ModelRegisteredPayload {
  modelId: string;
  owner: string;
  modelCommitment: string;
  metadataURI: string;
}
export interface ModelMetadataUpdatedPayload {
  modelId: string;
  metadataURI: string;
}
export interface ModelOwnershipTransferredPayload {
  modelId: string;
  previousOwner: string;
  newOwner: string;
}
export interface ModelRevokedPayload {
  modelId: string;
}
export interface LineageEdgeRegisteredPayload {
  edgeId: string;
  childModelId: string;
  parentModelId: string;
  confidenceLevel: ConfidenceLevel;
  royaltyBps: number;
  stake: bigint;
}
export interface LineageEdgeChallengedPayload {
  edgeId: string;
  challenger: string;
  bond: bigint;
}
export interface LineageEdgeResolvedPayload {
  edgeId: string;
  challengeUpheld: boolean;
}
export interface LineageEdgeFinalizedPayload {
  edgeId: string;
}

// --- ExecutionRegistry -------------------------------------------------

export interface SignerRegisteredPayload {
  provider: string;
  signer: string;
}
export interface SignerRevokedPayload {
  provider: string;
  signer: string;
}
export interface ProviderModeUpdatedPayload {
  provider: string;
  mode: number;
}
export interface UsageProofConsumedPayload {
  executionId: string;
  provider: string;
  modelId: string;
  requestHash: string;
}

// --- AttributionSettlement -------------------------------------------------

export interface ExecutionSettledPayload {
  executionId: string;
  modelId: string;
  provider: string;
  epoch: bigint;
  amount: bigint;
  servingConfidence: ConfidenceLevel;
}
export interface EdgeAttributedPayload {
  executionId: string;
  edgeId: string;
  childModelId: string;
  parentModelId: string;
  amount: bigint;
  effectiveConfidence: ConfidenceLevel;
}
export interface OwnerCreditedPayload {
  executionId: string;
  modelId: string;
  owner: string;
  amount: bigint;
}
export interface ClaimedPayload {
  recipient: string;
  amount: bigint;
}

// --- TrainingProvenanceRegistry -------------------------------------------------

export interface ProvenanceRegisteredPayload {
  childModelId: string;
  baseModelId: string;
  provider: string;
  registrant: string;
  commitment: string;
  taskId: string;
}

/** The union of every canonical event this indexer projects. Events that
 *  are intentionally not projected (`ParameterUpdated`, `EpochAdvanced`,
 *  `ResolverUpdated` — docs/indexer.md §4) are decoded and stored in the
 *  raw `events` table for provenance/audit purposes but are excluded
 *  from this union since projection.ts never needs to switch on them. */
export type CanonicalEvent =
  | EventEnvelope<"ModelRegistered", ModelRegisteredPayload>
  | EventEnvelope<"ModelMetadataUpdated", ModelMetadataUpdatedPayload>
  | EventEnvelope<"ModelOwnershipTransferred", ModelOwnershipTransferredPayload>
  | EventEnvelope<"ModelRevoked", ModelRevokedPayload>
  | EventEnvelope<"LineageEdgeRegistered", LineageEdgeRegisteredPayload>
  | EventEnvelope<"LineageEdgeChallenged", LineageEdgeChallengedPayload>
  | EventEnvelope<"LineageEdgeResolved", LineageEdgeResolvedPayload>
  | EventEnvelope<"LineageEdgeFinalized", LineageEdgeFinalizedPayload>
  | EventEnvelope<"SignerRegistered", SignerRegisteredPayload>
  | EventEnvelope<"SignerRevoked", SignerRevokedPayload>
  | EventEnvelope<"ProviderModeUpdated", ProviderModeUpdatedPayload>
  | EventEnvelope<"UsageProofConsumed", UsageProofConsumedPayload>
  | EventEnvelope<"ExecutionSettled", ExecutionSettledPayload>
  | EventEnvelope<"EdgeAttributed", EdgeAttributedPayload>
  | EventEnvelope<"OwnerCredited", OwnerCreditedPayload>
  | EventEnvelope<"Claimed", ClaimedPayload>
  | EventEnvelope<"ProvenanceRegistered", ProvenanceRegisteredPayload>;

/** Events decoded and stored for provenance/audit but with no projection
 *  handler — see docs/indexer.md §4. */
export const UNPROJECTED_EVENT_NAMES = new Set([
  "ParameterUpdated",
  "EpochAdvanced",
  "ResolverUpdated",
]);

// --- Projection row shapes (query-layer return types) -------------------------------------------------

export type ModelStatus = "Active" | "Revoked";
export type EdgeStatus = "Pending" | "Challenged" | "Finalized" | "Rejected";

export interface ModelRow {
  modelId: string;
  owner: string;
  modelCommitment: string;
  metadataURI: string;
  status: ModelStatus;
  createdAtBlock: number;
  createdAtTimestamp: number;
}

export interface EdgeRow {
  edgeId: string;
  childModelId: string;
  parentModelId: string;
  confidenceLevel: ConfidenceLevel;
  royaltyBps: number;
  stake: bigint;
  status: EdgeStatus;
  challenger: string | null;
  challengeBond: bigint | null;
  registeredAtBlock: number;
}

export interface SignerRow {
  signer: string;
  provider: string | null;
  active: boolean;
}

export interface ProviderSummary {
  provider: string;
  mode: number | null;
  signerCount: number;
}

export interface TrainingProvenanceRow {
  childModelId: string;
  baseModelId: string;
  provider: string;
  registrant: string;
  commitment: string;
  taskId: string;
  registeredAtBlock: number;
}

export interface ExecutionRow {
  executionId: string;
  provider: string | null;
  modelId: string | null;
  requestHash: string | null;
  epoch: bigint | null;
  amount: bigint | null;
  servingConfidence: ConfidenceLevel | null;
  consumedAtBlock: number | null;
  settledAtBlock: number | null;
}

export interface EdgeAttributionRow {
  executionId: string;
  edgeId: string;
  childModelId: string;
  parentModelId: string;
  amount: bigint;
  effectiveConfidence: ConfidenceLevel;
}

export interface OwnerCreditRow {
  executionId: string;
  modelId: string;
  owner: string;
  amount: bigint;
}

export interface ClaimRow {
  recipient: string;
  amount: bigint;
  blockNumber: number;
  transactionHash: string;
}

export interface SyncStatus {
  chainId: bigint;
  lastIndexedBlock: number | null;
  lastIndexedBlockHash: string | null;
  headBlock: number;
  safeHead: number;
  lagBlocks: number;
}

export interface StoredEventRow {
  chainId: bigint;
  contractAddress: string;
  eventName: string;
  blockNumber: number;
  blockHash: string;
  blockTimestamp: number;
  transactionHash: string;
  transactionIndex: number | null;
  logIndex: number;
  payload: unknown;
}
