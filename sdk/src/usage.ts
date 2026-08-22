import { ethers } from "ethers";
import { Contracts } from "./contracts";
import { sendAndWait } from "./tx";
import { UsageProof, VerifiedUsage } from "./types";

/**
 * Verification calls `ExecutionRegistry.verifyUsageProof` — a free
 * staticCall into the contract's own logic, exactly the pattern
 * relayer/src/verifier.ts already established (ADR 0009). This function
 * does not reimplement EIP-712 recovery, the model-commitment
 * cross-check, or replay/expiry checks; it asks the contract to do them
 * and returns its answer.
 */
export async function verifyUsageProof(contracts: Contracts, proof: UsageProof, signature: string): Promise<VerifiedUsage> {
  const result = await contracts.executionRegistry.verifyUsageProof.staticCall(proof, signature);
  return {
    signer: result.signer,
    provider: result.provider,
    modelId: result.modelId,
    executionId: result.executionId,
    requestHash: result.requestHash,
    responseHash: result.responseHash,
    servingConfidence: Number(result.servingConfidence),
  };
}

/**
 * Single-attempt submission to `AttributionSettlement.settleExecution`.
 *
 * **This is not the canonical submission path.** It has no retry
 * strategy, no fee-bump replacement, no duplicate/race handling beyond
 * whatever ExecutionRegistry's own replay protection provides, and no
 * multi-relayer awareness. For anything production-grade, submit through
 * `relayer/` instead (docs/relayer.md) — this function exists for
 * read-only integrators, scripts, and tests that need a straightforward
 * one-shot call.
 *
 * The caller supplies `feeOverride` only as an escape hatch for tests
 * that have changed `attributionFeePerExecution`; in normal use, omit it
 * and this function reads the live fee itself — the SDK does not let a
 * caller choose an arbitrary settlement amount, matching
 * `AttributionSettlement`'s own contract-derived-amount guarantee.
 */
export async function submitUsageProof(
  contracts: Contracts,
  proof: UsageProof,
  signature: string,
  feeOverride?: bigint
): Promise<{ executionId: string; receipt: ethers.ContractTransactionReceipt }> {
  const fee = feeOverride ?? (await contracts.attributionSettlement.attributionFeePerExecution());
  const receipt = await sendAndWait(contracts.attributionSettlement.settleExecution(proof, signature, { value: fee }));

  let executionId = "";
  for (const log of receipt.logs) {
    try {
      const parsed = contracts.attributionSettlement.interface.parseLog(log);
      if (parsed?.name === "ExecutionSettled") {
        executionId = parsed.args.executionId as string;
        break;
      }
    } catch {
      // not this contract's event
    }
  }
  if (!executionId) throw new Error(`ExecutionSettled event not found in transaction ${receipt.hash}`);
  return { executionId, receipt };
}
