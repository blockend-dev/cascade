/**
 * Structural types matching the deployed contracts exactly. Field-for-field
 * identical to relayer/src/types.ts and wrapper/src/types.ts's UsageProof —
 * this is a TypeScript ergonomics duplication across three independently
 * runnable packages, not a second protocol representation. See ADR 0012.
 * There is exactly one executionId derivation and it lives in
 * ExecutionRegistry; nothing here recomputes or reinterprets it.
 */

export enum ModelStatus {
  Active = 0,
  Revoked = 1,
}

/** Ascending strength, matching CascadeRegistry.ConfidenceLevel exactly:
 *  Declared < AttestedTraining < CryptographicallyBound. In user-facing
 *  terms these are Level 3 / Level 2 / Level 1 respectively — see
 *  docs/protocol-spec.md §1 for why the two numbering schemes
 *  deliberately run in opposite directions. */
export enum ConfidenceLevel {
  Declared = 0,
  AttestedTraining = 1,
  CryptographicallyBound = 2,
}

export enum EdgeStatus {
  Pending = 0,
  Challenged = 1,
  Finalized = 2,
  Rejected = 3,
}

export enum ProviderMode {
  Standard = 0,
  CascadeWrapper = 1,
}

export interface Model {
  owner: string;
  modelCommitment: string;
  metadataURI: string;
  status: ModelStatus;
  createdAt: bigint;
}

export interface LineageEdge {
  childModelId: string;
  parentModelId: string;
  confidenceLevel: ConfidenceLevel;
  royaltyBps: number;
  evidenceHash: string;
  stake: bigint;
  challengeDeadline: bigint;
  status: EdgeStatus;
  challenger: string;
  challengeBond: bigint;
}

/** Mirrors ExecutionRegistry.UsageProof — field order matters for EIP-712
 *  encoding. Do not reorder without also updating sdk/src/eip712.ts. */
export interface UsageProof {
  modelId: string;
  modelCommitment: string;
  requestHash: string;
  responseHash: string;
  chatId: string;
  epoch: bigint;
  issuedAt: bigint;
}

/** Mirrors ExecutionRegistry.VerifiedUsage — every field here is derived
 *  by the contract, never supplied by a caller. */
export interface VerifiedUsage {
  signer: string;
  provider: string;
  modelId: string;
  executionId: string;
  requestHash: string;
  responseHash: string;
  servingConfidence: ConfidenceLevel;
}

/** Mirrors TrainingProvenanceRegistry.TrainingProvenanceClaim — field
 *  order matters for EIP-712 encoding. */
export interface TrainingProvenanceClaim {
  childModelId: string;
  baseModelId: string;
  baseModelHash: string;
  datasetRootHash: string;
  scriptHash: string;
  resultRootHash: string;
  taskId: string;
  evidenceURI: string;
  issuedAt: bigint;
}

export interface TrainingProvenance {
  baseModelId: string;
  baseModelHash: string;
  datasetRootHash: string;
  scriptHash: string;
  resultRootHash: string;
  taskId: string;
  evidenceURI: string;
  provider: string;
  registrant: string;
  issuedAt: bigint;
  registeredAt: bigint;
}

export interface CascadeAddresses {
  cascadeRegistry: string;
  executionRegistry: string;
  attributionSettlement: string;
  trainingProvenanceRegistry: string;
}
