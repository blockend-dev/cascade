import { ethers } from "ethers";
import { EXECUTION_REGISTRY_ABI } from "./abi";
import { ProofStatus, SignedUsageProof, UsageProof, VerificationOutcome, VerifiedUsage } from "./types";

const UINT64_MAX = (1n << 64n) - 1n;

/** Must match ExecutionRegistry.USAGE_PROOF_TYPEHASH field-for-field,
 *  including order. Cross-checked against the live contract's own
 *  hashTypedDataDigest in contracts/test/relayer/verifier.test.ts —
 *  the same TS/Solidity encoding cross-check pattern used in Phase 3. */
export const USAGE_PROOF_TYPES = {
  UsageProof: [
    { name: "modelId", type: "bytes32" },
    { name: "modelCommitment", type: "bytes32" },
    { name: "requestHash", type: "bytes32" },
    { name: "responseHash", type: "bytes32" },
    { name: "chatId", type: "bytes32" },
    { name: "epoch", type: "uint64" },
    { name: "issuedAt", type: "uint64" },
  ],
};

export function eip712Domain(chainId: bigint, verifyingContract: string) {
  return { name: "Cascade", version: "1", chainId, verifyingContract };
}

/**
 * Cheap, no-RPC structural validation. Exists so garbage input (malformed
 * JSON fields, huge integers, wrong-length hex) is rejected before it
 * costs a single network round-trip — see docs/threat-model.md's relayer
 * section for the hostile-input assumption this defends against.
 */
export function validateStructure(signed: unknown): { ok: true; value: SignedUsageProof } | { ok: false; reason: string } {
  if (typeof signed !== "object" || signed === null) return { ok: false, reason: "payload is not an object" };
  const { proof, signature } = signed as Partial<SignedUsageProof>;
  if (typeof proof !== "object" || proof === null) return { ok: false, reason: "missing proof object" };
  if (typeof signature !== "string") return { ok: false, reason: "missing signature" };

  const p = proof as Partial<UsageProof>;
  const hashFields: Array<keyof UsageProof> = ["modelId", "modelCommitment", "requestHash", "responseHash", "chatId"];
  for (const field of hashFields) {
    const value = p[field];
    if (typeof value !== "string" || !ethers.isHexString(value, 32)) {
      return { ok: false, reason: `proof.${field} must be a 32-byte hex string` };
    }
  }
  if (!ethers.isHexString(signature, 65)) {
    return { ok: false, reason: "signature must be a 65-byte hex string" };
  }

  let epoch: bigint;
  let issuedAt: bigint;
  try {
    epoch = BigInt(p.epoch as unknown as string | number | bigint);
    issuedAt = BigInt(p.issuedAt as unknown as string | number | bigint);
  } catch {
    return { ok: false, reason: "proof.epoch and proof.issuedAt must be integers" };
  }
  if (epoch < 0n || epoch > UINT64_MAX) return { ok: false, reason: "proof.epoch out of uint64 range" };
  if (issuedAt < 0n || issuedAt > UINT64_MAX) return { ok: false, reason: "proof.issuedAt out of uint64 range" };

  return {
    ok: true,
    value: {
      proof: {
        modelId: p.modelId as string,
        modelCommitment: p.modelCommitment as string,
        requestHash: p.requestHash as string,
        responseHash: p.responseHash as string,
        chatId: p.chatId as string,
        epoch,
        issuedAt,
      },
      signature,
    },
  };
}

export class Verifier {
  private readonly executionRegistry: ethers.Contract;

  constructor(
    private readonly provider: ethers.Provider,
    executionRegistryAddress: string,
    private readonly attributionSettlementReader: { currentEpoch(): Promise<bigint> }
  ) {
    this.executionRegistry = new ethers.Contract(executionRegistryAddress, EXECUTION_REGISTRY_ABI, provider);
  }

  /**
   * The full pipeline. Every meaningful check either IS the deployed
   * contract's own logic (via a free staticCall — zero drift risk,
   * because it's not a reimplementation, it's the real thing) or a direct
   * on-chain state read. Nothing here is trusted from the caller.
   */
  async verify(rawSigned: unknown): Promise<VerificationOutcome> {
    const structural = validateStructure(rawSigned);
    if (!structural.ok) {
      return { ok: false, status: ProofStatus.REJECTED_MALFORMED, reason: structural.reason };
    }
    const { proof, signature } = structural.value;

    // Authoritative on-chain simulation — this call reverts with the
    // exact same custom error consumeUsageProof would, without spending
    // gas or touching state. See docs/relayer.md "Verification strategy."
    let usage: VerifiedUsage;
    try {
      const result = await this.executionRegistry.verifyUsageProof.staticCall(proof, signature);
      usage = {
        signer: result.signer as string,
        provider: result.provider as string,
        modelId: result.modelId as string,
        executionId: result.executionId as string,
        requestHash: result.requestHash as string,
        responseHash: result.responseHash as string,
        servingConfidence: Number(result.servingConfidence),
      };
    } catch (err) {
      return { ok: false, status: ProofStatus.INVALID, reason: describeRevert(err) };
    }

    const consumed: boolean = await this.executionRegistry.executionConsumed(usage.executionId);
    if (consumed) {
      return { ok: false, status: ProofStatus.ALREADY_CONSUMED, executionId: usage.executionId };
    }

    const currentEpoch = await this.attributionSettlementReader.currentEpoch();
    if (proof.epoch < currentEpoch) {
      return {
        ok: false,
        status: ProofStatus.EPOCH_EXPIRED,
        executionId: usage.executionId,
        proofEpoch: proof.epoch,
        currentEpoch,
      };
    }
    if (proof.epoch > currentEpoch) {
      return {
        ok: false,
        status: ProofStatus.EPOCH_NOT_YET_OPEN,
        executionId: usage.executionId,
        proofEpoch: proof.epoch,
        currentEpoch,
      };
    }

    return { ok: true, usage };
  }
}

/** Best-effort decoding of a custom-error revert into a short, log-safe string. */
export function describeRevert(err: unknown): string {
  const e = err as { shortMessage?: string; reason?: string; message?: string };
  return e.shortMessage ?? e.reason ?? e.message ?? "unknown revert";
}
