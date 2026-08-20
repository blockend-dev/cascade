import { ethers } from "ethers";
import { ATTRIBUTION_SETTLEMENT_ABI } from "./abi";
import { RelayerConfig } from "./config";
import { logger } from "./logger";
import { backoffDelayMs, sleep } from "./retry";
import { describeRevert } from "./verifier";
import { ProofStatus, SubmissionOutcome, UsageProof, VerifiedUsage } from "./types";

type ErrorClass = { kind: "duplicate" | "permanent" | "transient"; reason: string };

const DUPLICATE_PATTERN = /ExecutionAlreadyConsumed/i;
const PERMANENT_PATTERNS =
  /IncorrectFunding|InvalidEpoch|ModelCommitmentMismatch|UnregisteredSigner|ProofExpired|ProofNotYetValid/i;

/** Classifies a caught error against the contract's own vocabulary — see
 *  docs/relayer.md "Failure classification." A race lost to another
 *  relayer (ExecutionAlreadyConsumed) is success, not failure. */
function classifyError(err: unknown): ErrorClass {
  const reason = describeRevert(err);
  const code = (err as { code?: string })?.code;
  if (DUPLICATE_PATTERN.test(reason)) return { kind: "duplicate", reason };
  if (PERMANENT_PATTERNS.test(reason)) return { kind: "permanent", reason };
  // TIMEOUT (confirmation wait exceeded), NETWORK_ERROR, SERVER_ERROR,
  // REPLACEMENT_UNDERPRICED, and plain nonce/gas hiccups are all
  // infrastructure-shaped, not proof-shaped — retry them.
  return { kind: "transient", reason: code ? `${code}: ${reason}` : reason };
}

function scaleFee(fee: bigint | null | undefined, multiplier: number): bigint | undefined {
  if (fee === null || fee === undefined) return undefined;
  return (fee * BigInt(Math.round(multiplier * 1000))) / 1000n;
}

export class Submitter {
  private readonly attributionSettlement: ethers.Contract;
  /** Serializes every submission through this instance — one relayer
   *  process, one nonce sequence, zero internal nonce contention by
   *  construction. See docs/relayer.md "Transaction management": running
   *  multiple independent processes (each its own key) is how you
   *  parallelize and get redundancy, not internal concurrency here. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly signer: ethers.Signer,
    private readonly provider: ethers.Provider,
    attributionSettlementAddress: string,
    private readonly config: RelayerConfig
  ) {
    this.attributionSettlement = new ethers.Contract(
      attributionSettlementAddress,
      ATTRIBUTION_SETTLEMENT_ABI,
      signer
    );
  }

  currentEpoch(): Promise<bigint> {
    return this.attributionSettlement.currentEpoch();
  }

  async submit(proof: UsageProof, signature: string, usage: VerifiedUsage): Promise<SubmissionOutcome> {
    const result = this.queue.then(() => this.submitNow(proof, signature, usage));
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async submitNow(proof: UsageProof, signature: string, usage: VerifiedUsage): Promise<SubmissionOutcome> {
    const fee: bigint = await this.attributionSettlement.attributionFeePerExecution();
    const nonce = await this.signer.getNonce("pending");

    let attempt = 0;
    let lastReason = "unknown";

    while (attempt < this.config.maxSubmissionAttempts) {
      // Full dry-run of the exact transaction about to be sent. Catches a
      // race lost since verification (ExecutionAlreadyConsumed), an epoch
      // that advanced in the meantime, or anything else that changed —
      // this is the contract's own logic, simulated, not reimplemented.
      const preflight = await this.simulate(proof, signature, fee);
      if (preflight.kind === "duplicate") {
        logger.info("execution_already_settled", { executionId: usage.executionId, via: "simulation" });
        return { status: ProofStatus.DUPLICATE, executionId: usage.executionId, observedVia: "simulation" };
      }
      if (preflight.kind === "permanent") {
        logger.warn("settlement_permanently_rejected", {
          executionId: usage.executionId,
          reason: preflight.reason,
        });
        return { status: ProofStatus.PERMANENT_FAILURE, executionId: usage.executionId, reason: preflight.reason };
      }

      const outcome = await this.attemptSend(proof, signature, fee, nonce, attempt, usage.executionId);
      if (outcome.done) return outcome.result;
      lastReason = outcome.reason;

      attempt++;
      if (attempt < this.config.maxSubmissionAttempts) {
        const delay = backoffDelayMs(attempt, this.config.retryBaseDelayMs, this.config.retryMaxDelayMs);
        logger.info("retry_scheduled", {
          executionId: usage.executionId,
          attempt,
          delayMs: delay,
          reason: lastReason,
        });
        await sleep(delay);
      }
    }

    logger.error("retry_exhausted", { executionId: usage.executionId, attempts: attempt, reason: lastReason });
    return {
      status: ProofStatus.RETRYABLE_FAILURE,
      executionId: usage.executionId,
      reason: lastReason,
      attempts: attempt,
    };
  }

  private async simulate(proof: UsageProof, signature: string, fee: bigint): Promise<ErrorClass | { kind: "ok" }> {
    try {
      await this.attributionSettlement.settleExecution.staticCall(proof, signature, { value: fee });
      return { kind: "ok" };
    } catch (err) {
      return classifyError(err);
    }
  }

  private async attemptSend(
    proof: UsageProof,
    signature: string,
    fee: bigint,
    nonce: number,
    attempt: number,
    executionId: string
  ): Promise<{ done: true; result: SubmissionOutcome } | { done: false; reason: string }> {
    try {
      const feeData = await this.provider.getFeeData();
      const bump = 1 + attempt * this.config.gasBumpPerAttempt;
      const tx = await this.attributionSettlement.settleExecution(proof, signature, {
        value: fee,
        nonce,
        maxFeePerGas: scaleFee(feeData.maxFeePerGas, bump),
        maxPriorityFeePerGas: scaleFee(feeData.maxPriorityFeePerGas, bump),
      });
      logger.info("transaction_submitted", { executionId, txHash: tx.hash, attempt, nonce });

      const receipt = await tx.wait(this.config.confirmations, this.config.confirmationTimeoutMs);
      if (receipt && receipt.status === 1) {
        logger.info("transaction_confirmed", {
          executionId,
          txHash: receipt.hash,
          blockNumber: receipt.blockNumber,
        });
        return {
          done: true,
          result: {
            status: ProofStatus.SETTLED,
            executionId,
            txHash: receipt.hash,
            blockNumber: receipt.blockNumber,
          },
        };
      }
      // Defensive path: some providers return a status:0 receipt instead
      // of throwing. Re-simulate for a clean, decoded reason rather than
      // guessing from a bare status flag.
      const explained = await this.simulate(proof, signature, fee);
      if (explained.kind === "duplicate") {
        return { done: true, result: { status: ProofStatus.DUPLICATE, executionId, observedVia: "revert" } };
      }
      const reason = explained.kind === "ok" ? "reverted on-chain despite a clean re-simulation" : explained.reason;
      return { done: true, result: { status: ProofStatus.PERMANENT_FAILURE, executionId, reason } };
    } catch (err) {
      const classification = classifyError(err);
      if (classification.kind === "duplicate") {
        return { done: true, result: { status: ProofStatus.DUPLICATE, executionId, observedVia: "revert" } };
      }
      if (classification.kind === "permanent") {
        return {
          done: true,
          result: { status: ProofStatus.PERMANENT_FAILURE, executionId, reason: classification.reason },
        };
      }
      logger.warn("transaction_attempt_failed", { executionId, attempt, reason: classification.reason });
      return { done: false, reason: classification.reason };
    }
  }
}
