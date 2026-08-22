import { ethers } from "ethers";
import { Contracts } from "./contracts";
import { sendAndWait } from "./tx";
import { ConfidenceLevel, TrainingProvenanceClaim } from "./types";

/** Every write function in this module requires the `Contracts` instance
 *  to have been built with a signer, not a bare provider (see
 *  client.ts). Checked explicitly and thrown clearly here rather than
 *  left to surface as an opaque ethers error deep in a call stack —
 *  "sensible read-only usage without a signer" (Phase 8 brief) cuts both
 *  ways: read APIs must work without one, write APIs must fail
 *  obviously, not mysteriously, when one is missing. */
function requireSigner(contracts: Contracts): void {
  const runner = contracts.cascadeRegistry.runner;
  if (!runner || typeof (runner as ethers.Signer).sendTransaction !== "function") {
    throw new Error(
      "This operation requires a signer. The client was created read-only (no signer supplied) — " +
        "see client.ts's createCascadeClient."
    );
  }
}

function findEventArg<T = unknown>(receipt: ethers.ContractTransactionReceipt, contract: ethers.Contract, eventName: string, argName: string): T {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) return parsed.args[argName] as T;
    } catch {
      // not this contract's event
    }
  }
  throw new Error(`Event ${eventName} not found in transaction ${receipt.hash}`);
}

// ---------------------------------------------------------------------
// CascadeRegistry writes
// ---------------------------------------------------------------------

export async function registerModel(
  contracts: Contracts,
  modelCommitment: string,
  metadataURI: string,
  salt: string = ethers.hexlify(ethers.randomBytes(32))
): Promise<{ modelId: string; receipt: ethers.ContractTransactionReceipt }> {
  requireSigner(contracts);
  const receipt = await sendAndWait(contracts.cascadeRegistry.registerModel(modelCommitment, metadataURI, salt));
  const modelId = findEventArg<string>(receipt, contracts.cascadeRegistry, "ModelRegistered", "modelId");
  return { modelId, receipt };
}

export async function updateMetadataURI(contracts: Contracts, modelId: string, metadataURI: string) {
  requireSigner(contracts);
  return sendAndWait(contracts.cascadeRegistry.updateMetadataURI(modelId, metadataURI));
}

export async function transferModelOwnership(contracts: Contracts, modelId: string, newOwner: string) {
  requireSigner(contracts);
  return sendAndWait(contracts.cascadeRegistry.transferModelOwnership(modelId, newOwner));
}

export async function revokeModel(contracts: Contracts, modelId: string) {
  requireSigner(contracts);
  return sendAndWait(contracts.cascadeRegistry.revokeModel(modelId));
}

export async function registerLineageEdge(
  contracts: Contracts,
  childModelId: string,
  parentModelId: string,
  confidenceLevel: ConfidenceLevel,
  royaltyBps: number,
  evidenceHash: string,
  stake: bigint
): Promise<{ edgeId: string; receipt: ethers.ContractTransactionReceipt }> {
  requireSigner(contracts);
  const receipt = await sendAndWait(
    contracts.cascadeRegistry.registerLineageEdge(childModelId, parentModelId, confidenceLevel, royaltyBps, evidenceHash, {
      value: stake,
    })
  );
  const edgeId = findEventArg<string>(receipt, contracts.cascadeRegistry, "LineageEdgeRegistered", "edgeId");
  return { edgeId, receipt };
}

export async function challengeEdge(contracts: Contracts, edgeId: string, bond: bigint) {
  requireSigner(contracts);
  return sendAndWait(contracts.cascadeRegistry.challengeEdge(edgeId, { value: bond }));
}

/** Owner/resolver-gated on-chain — see docs/adr/0004 ("Resolver" is a
 *  documented centralization point, not decentralized adjudication). The
 *  SDK does not attempt to hide or soften that; it will simply revert for
 *  a non-resolver caller. */
export async function resolveChallenge(contracts: Contracts, edgeId: string, challengeUpheld: boolean) {
  requireSigner(contracts);
  return sendAndWait(contracts.cascadeRegistry.resolveChallenge(edgeId, challengeUpheld));
}

export async function finalizeEdge(contracts: Contracts, edgeId: string) {
  requireSigner(contracts);
  return sendAndWait(contracts.cascadeRegistry.finalizeEdge(edgeId));
}

// ---------------------------------------------------------------------
// ExecutionRegistry writes
// ---------------------------------------------------------------------

export async function registerProviderSigner(contracts: Contracts, signerAddress: string) {
  requireSigner(contracts);
  return sendAndWait(contracts.executionRegistry.registerSigner(signerAddress));
}

export async function revokeProviderSigner(contracts: Contracts, signerAddress: string) {
  requireSigner(contracts);
  return sendAndWait(contracts.executionRegistry.revokeSigner(signerAddress));
}

// ---------------------------------------------------------------------
// TrainingProvenanceRegistry writes
// ---------------------------------------------------------------------

export async function registerProvenance(
  contracts: Contracts,
  claim: TrainingProvenanceClaim,
  signature: string
): Promise<{ commitment: string; receipt: ethers.ContractTransactionReceipt }> {
  requireSigner(contracts);
  const receipt = await sendAndWait(contracts.trainingProvenanceRegistry.registerProvenance(claim, signature));
  const commitment = findEventArg<string>(receipt, contracts.trainingProvenanceRegistry, "ProvenanceRegistered", "commitment");
  return { commitment, receipt };
}

// ---------------------------------------------------------------------
// AttributionSettlement writes
// ---------------------------------------------------------------------

export async function claimAttribution(contracts: Contracts) {
  requireSigner(contracts);
  return sendAndWait(contracts.attributionSettlement.claim());
}
