import { ethers } from "ethers";
import { RelayerConfig } from "./config";
import { ExecutionStore } from "./executionStore";
import { logger } from "./logger";
import { Metrics } from "./metrics";
import { Submitter } from "./submitter";
import { ProofStatus, SignedUsageProof, SubmissionOutcome, UsageProofSource, VerificationOutcome } from "./types";
import { Verifier } from "./verifier";

/**
 * Orchestrates ingestion -> verification -> submission -> local
 * bookkeeping. This is the one place that ties the pieces together; each
 * piece stays independently testable and independently replaceable. See
 * docs/relayer.md for the full trust-boundary writeup this class exists
 * to enforce end to end.
 */
export class CascadeRelayer {
  private readonly store = new ExecutionStore();
  private readonly metrics = new Metrics();

  constructor(
    private readonly verifier: Verifier,
    private readonly submitter: Submitter,
    private readonly source: UsageProofSource
  ) {}

  async start(): Promise<void> {
    await this.source.start((signed) => {
      this.metrics.inc("proofsReceived");
      void this.handle(signed);
    });
  }

  async stop(): Promise<void> {
    await this.source.stop();
  }

  getMetrics() {
    return this.metrics.snapshot();
  }

  /** Exposed directly for tests and for feeding proofs from a non-HTTP
   *  source without going through the network. */
  async handle(rawSigned: unknown): Promise<SubmissionOutcome | VerificationOutcome> {
    logger.debug("proof_received", {});

    const verification = await this.verifier.verify(rawSigned);
    if (!verification.ok) {
      this.recordVerificationFailure(verification);
      return verification;
    }

    const { usage } = verification;
    logger.info("proof_locally_verified", {
      executionId: usage.executionId,
      modelId: usage.modelId,
      provider: usage.provider,
      servingConfidence: usage.servingConfidence,
    });

    if (this.store.isKnownSettled(usage.executionId)) {
      logger.debug("execution_already_known_settled", { executionId: usage.executionId });
      this.metrics.inc("proofsDuplicate");
      return { status: ProofStatus.DUPLICATE, executionId: usage.executionId, observedVia: "simulation" };
    }

    this.store.upsert(usage.executionId, { status: ProofStatus.VERIFIED });

    const structural = rawSigned as SignedUsageProof; // safe: verification.ok implies structural validity already occurred
    const outcome = await this.submitter.submit(structural.proof, structural.signature, usage);
    this.recordSubmissionOutcome(outcome);
    return outcome;
  }

  private recordVerificationFailure(verification: Extract<VerificationOutcome, { ok: false }>): void {
    switch (verification.status) {
      case ProofStatus.REJECTED_MALFORMED:
        this.metrics.inc("proofsRejected");
        logger.warn("proof_rejected", { reason: verification.reason, status: verification.status });
        return;
      case ProofStatus.INVALID:
        this.metrics.inc("proofsRejected");
        logger.warn("proof_rejected", { reason: verification.reason, status: verification.status });
        return;
      case ProofStatus.ALREADY_CONSUMED:
        this.metrics.inc("proofsDuplicate");
        logger.info("proof_already_settled", { executionId: verification.executionId });
        this.store.upsert(verification.executionId, { status: ProofStatus.DUPLICATE });
        return;
      case ProofStatus.EPOCH_NOT_YET_OPEN:
      case ProofStatus.EPOCH_EXPIRED:
        logger.info("proof_epoch_ineligible", {
          executionId: verification.executionId,
          status: verification.status,
          proofEpoch: verification.proofEpoch.toString(),
          currentEpoch: verification.currentEpoch.toString(),
        });
        return;
    }
  }

  private recordSubmissionOutcome(outcome: SubmissionOutcome): void {
    switch (outcome.status) {
      case ProofStatus.SETTLED:
        this.metrics.inc("proofsSettled");
        this.store.upsert(outcome.executionId, { status: ProofStatus.SETTLED, txHash: outcome.txHash });
        return;
      case ProofStatus.DUPLICATE:
        this.metrics.inc("proofsDuplicate");
        this.store.upsert(outcome.executionId, { status: ProofStatus.DUPLICATE });
        return;
      case ProofStatus.PERMANENT_FAILURE:
        this.metrics.inc("transactionFailures");
        this.store.upsert(outcome.executionId, { status: ProofStatus.PERMANENT_FAILURE, reason: outcome.reason });
        return;
      case ProofStatus.RETRYABLE_FAILURE:
        this.metrics.inc("transactionFailures");
        this.store.upsert(outcome.executionId, {
          status: ProofStatus.RETRYABLE_FAILURE,
          reason: outcome.reason,
          attempts: outcome.attempts,
        });
        return;
    }
  }
}

export function buildRelayer(config: RelayerConfig, provider: ethers.Provider, signer: ethers.Signer) {
  const submitter = new Submitter(signer, provider, config.attributionSettlementAddress, config);
  const verifier = new Verifier(provider, config.executionRegistryAddress, { currentEpoch: () => submitter.currentEpoch() });
  return { verifier, submitter };
}
