import { ethers } from "ethers";
import { TrainingProvenanceClaim, UsageProof } from "./types";

/**
 * Domain + typed-data structures for signing. This is the one place the
 * SDK necessarily defines EIP-712 structures locally rather than wrapping
 * a contract call — there is no way to ask a contract to sign on a
 * caller's behalf. Field order is copied from
 * ExecutionRegistry.USAGE_PROOF_TYPEHASH and
 * TrainingProvenanceRegistry.TRAINING_PROVENANCE_CLAIM_TYPEHASH exactly;
 * `sdk/test`'s cross-check test proves the resulting digest matches the
 * contract's own `hashTypedDataDigest` byte for byte — see ADR 0012.
 *
 * This module is for *constructing and signing* only. For *verifying* a
 * proof or claim, call the contract (ExecutionRegistry.verifyUsageProof,
 * TrainingProvenanceRegistry.hashTypedDataDigest) via sdk/src/usage.ts —
 * never re-derive a verification result from these types alone.
 */

export const CASCADE_DOMAIN_NAME = "Cascade";
export const CASCADE_DOMAIN_VERSION = "1";

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: bigint;
  verifyingContract: string;
}

export function usageProofDomain(chainId: bigint, executionRegistryAddress: string): Eip712Domain {
  return {
    name: CASCADE_DOMAIN_NAME,
    version: CASCADE_DOMAIN_VERSION,
    chainId,
    verifyingContract: executionRegistryAddress,
  };
}

export function trainingProvenanceClaimDomain(chainId: bigint, trainingProvenanceRegistryAddress: string): Eip712Domain {
  return {
    name: CASCADE_DOMAIN_NAME,
    version: CASCADE_DOMAIN_VERSION,
    chainId,
    verifyingContract: trainingProvenanceRegistryAddress,
  };
}

// Deliberately not `as const` — ethers' signTypedData/TypedDataEncoder
// expect a mutable Record<string, TypedDataField[]>, and a readonly
// array (what `as const` produces) doesn't structurally satisfy that,
// even though the values themselves never change at runtime.
export const USAGE_PROOF_TYPES: Record<string, ethers.TypedDataField[]> = {
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

export const TRAINING_PROVENANCE_CLAIM_TYPES: Record<string, ethers.TypedDataField[]> = {
  TrainingProvenanceClaim: [
    { name: "childModelId", type: "bytes32" },
    { name: "baseModelId", type: "bytes32" },
    { name: "baseModelHash", type: "bytes32" },
    { name: "datasetRootHash", type: "bytes32" },
    { name: "scriptHash", type: "bytes32" },
    { name: "resultRootHash", type: "bytes32" },
    { name: "taskId", type: "bytes32" },
    { name: "evidenceURI", type: "string" },
    { name: "issuedAt", type: "uint64" },
  ],
};

export async function signUsageProof(signer: ethers.Signer, domain: Eip712Domain, proof: UsageProof): Promise<string> {
  return signer.signTypedData(domain, USAGE_PROOF_TYPES, proof);
}

export async function signTrainingProvenanceClaim(
  signer: ethers.Signer,
  domain: Eip712Domain,
  claim: TrainingProvenanceClaim
): Promise<string> {
  return signer.signTypedData(domain, TRAINING_PROVENANCE_CLAIM_TYPES, claim);
}

/** Local digest computation — provided for callers who want to compare
 *  against a contract's `hashTypedDataDigest` themselves (e.g. before
 *  paying gas to submit). Not used internally for verification — see
 *  sdk/src/usage.ts, which always calls the contract instead. */
export function usageProofDigest(domain: Eip712Domain, proof: UsageProof): string {
  return ethers.TypedDataEncoder.hash(domain, USAGE_PROOF_TYPES, proof);
}

export function trainingProvenanceClaimDigest(domain: Eip712Domain, claim: TrainingProvenanceClaim): string {
  return ethers.TypedDataEncoder.hash(domain, TRAINING_PROVENANCE_CLAIM_TYPES, claim);
}
