/**
 * Shared types. See docs/relayer.md for the trust boundary these encode:
 * the relayer is a liveness/convenience component, never an authority —
 * nothing in this file lets a caller supply a recipient, an amount, a
 * provider, or a model. Those are always derived on-chain.
 */

/** Mirrors ExecutionRegistry.UsageProof exactly — field order matters for
 *  EIP-712 encoding. Do not reorder without updating USAGE_PROOF_TYPES. */
export interface UsageProof {
  modelId: string;
  modelCommitment: string;
  requestHash: string;
  responseHash: string;
  chatId: string;
  epoch: bigint;
  issuedAt: bigint;
}

export interface SignedUsageProof {
  proof: UsageProof;
  signature: string;
}

/** Mirrors ExecutionRegistry.VerifiedUsage — returned by a successful
 *  on-chain verifyUsageProof simulation. Every field here is derived by
 *  the contract, never supplied by the relayer or its caller. */
export interface VerifiedUsage {
  signer: string;
  provider: string;
  modelId: string;
  executionId: string;
  requestHash: string;
  responseHash: string;
  servingConfidence: number;
}

/**
 * The relayer's own operational lifecycle for one proof. Distinct from
 * on-chain state (CascadeRegistry/ExecutionRegistry/AttributionSettlement
 * state) — this is purely local bookkeeping for observability and
 * avoiding redundant work. It is never consulted as a source of economic
 * truth; see docs/relayer.md "Idempotency."
 */
export enum ProofStatus {
  DISCOVERED = "DISCOVERED",
  REJECTED_MALFORMED = "REJECTED_MALFORMED",
  VERIFIED = "VERIFIED",
  ALREADY_CONSUMED = "ALREADY_CONSUMED",
  EPOCH_NOT_YET_OPEN = "EPOCH_NOT_YET_OPEN",
  EPOCH_EXPIRED = "EPOCH_EXPIRED",
  SUBMITTING = "SUBMITTING",
  PENDING = "PENDING",
  CONFIRMED = "CONFIRMED",
  SETTLED = "SETTLED",
  DUPLICATE = "DUPLICATE",
  INVALID = "INVALID",
  RETRYABLE_FAILURE = "RETRYABLE_FAILURE",
  PERMANENT_FAILURE = "PERMANENT_FAILURE",
}

export type VerificationOutcome =
  | { ok: true; usage: VerifiedUsage }
  | { ok: false; status: ProofStatus.REJECTED_MALFORMED; reason: string }
  | { ok: false; status: ProofStatus.INVALID; reason: string }
  | { ok: false; status: ProofStatus.ALREADY_CONSUMED; executionId: string }
  | { ok: false; status: ProofStatus.EPOCH_NOT_YET_OPEN; executionId: string; proofEpoch: bigint; currentEpoch: bigint }
  | { ok: false; status: ProofStatus.EPOCH_EXPIRED; executionId: string; proofEpoch: bigint; currentEpoch: bigint };

export type SubmissionOutcome =
  | { status: ProofStatus.SETTLED; executionId: string; txHash: string; blockNumber: number }
  | { status: ProofStatus.DUPLICATE; executionId: string; observedVia: "simulation" | "revert" }
  | { status: ProofStatus.PERMANENT_FAILURE; executionId: string; reason: string }
  | { status: ProofStatus.RETRYABLE_FAILURE; executionId: string; reason: string; attempts: number };

/** Ingestion boundary — see docs/relayer.md "Source of usage proofs."
 *  Deliberately narrow: Phase 5 does not build Phase 9's indexer. */
export interface UsageProofSource {
  start(onProof: (signed: SignedUsageProof) => void): Promise<void>;
  stop(): Promise<void>;
}
