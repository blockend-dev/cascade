import { ethers } from "ethers";
import { Contracts } from "./contracts";
import {
  ConfidenceLevel,
  EdgeStatus,
  LineageEdge,
  Model,
  ModelStatus,
  ProviderMode,
  TrainingProvenance,
} from "./types";

// ---------------------------------------------------------------------
// Mappers — ethers returns a tuple-shaped Result for a struct; these
// convert to the plain interfaces in types.ts so callers never need to
// know ethers' Result type exists.
// ---------------------------------------------------------------------

function toModel(r: ethers.Result): Model {
  return {
    owner: r.owner,
    modelCommitment: r.modelCommitment,
    metadataURI: r.metadataURI,
    status: Number(r.status) as ModelStatus,
    createdAt: r.createdAt,
  };
}

function toLineageEdge(r: ethers.Result): LineageEdge {
  return {
    childModelId: r.childModelId,
    parentModelId: r.parentModelId,
    confidenceLevel: Number(r.confidenceLevel) as ConfidenceLevel,
    royaltyBps: Number(r.royaltyBps),
    evidenceHash: r.evidenceHash,
    stake: r.stake,
    challengeDeadline: r.challengeDeadline,
    status: Number(r.status) as EdgeStatus,
    challenger: r.challenger,
    challengeBond: r.challengeBond,
  };
}

function toTrainingProvenance(r: ethers.Result): TrainingProvenance {
  return {
    baseModelId: r.baseModelId,
    baseModelHash: r.baseModelHash,
    datasetRootHash: r.datasetRootHash,
    scriptHash: r.scriptHash,
    resultRootHash: r.resultRootHash,
    taskId: r.taskId,
    evidenceURI: r.evidenceURI,
    provider: r.provider,
    registrant: r.registrant,
    issuedAt: r.issuedAt,
    registeredAt: r.registeredAt,
  };
}

// ---------------------------------------------------------------------
// CascadeRegistry reads
// ---------------------------------------------------------------------

export async function getModel(contracts: Contracts, modelId: string): Promise<Model> {
  return toModel(await contracts.cascadeRegistry.getModel(modelId));
}

export async function getEdge(contracts: Contracts, edgeId: string): Promise<LineageEdge> {
  return toLineageEdge(await contracts.cascadeRegistry.getEdge(edgeId));
}

export async function computeEdgeId(contracts: Contracts, childModelId: string, parentModelId: string): Promise<string> {
  return contracts.cascadeRegistry.computeEdgeId(childModelId, parentModelId);
}

export async function getParentEdgeIds(contracts: Contracts, modelId: string): Promise<string[]> {
  return contracts.cascadeRegistry.getParentEdgeIds(modelId);
}

export async function pathConfidence(contracts: Contracts, edgeIds: string[]): Promise<ConfidenceLevel> {
  return Number(await contracts.cascadeRegistry.pathConfidence(edgeIds)) as ConfidenceLevel;
}

export interface CascadeRegistryParameters {
  maxParentBps: number;
  maxDepth: number;
  maxParentsPerModel: number;
  minStake: bigint;
  challengeBondAmount: bigint;
  challengeWindow: bigint;
  resolver: string;
}

export async function getCascadeRegistryParameters(contracts: Contracts): Promise<CascadeRegistryParameters> {
  const c = contracts.cascadeRegistry;
  const [maxParentBps, maxDepth, maxParentsPerModel, minStake, challengeBondAmount, challengeWindow, resolver] =
    await Promise.all([
      c.maxParentBps(),
      c.maxDepth(),
      c.maxParentsPerModel(),
      c.minStake(),
      c.challengeBondAmount(),
      c.challengeWindow(),
      c.resolver(),
    ]);
  return {
    maxParentBps: Number(maxParentBps),
    maxDepth: Number(maxDepth),
    maxParentsPerModel: Number(maxParentsPerModel),
    minStake,
    challengeBondAmount,
    challengeWindow,
    resolver,
  };
}

// ---------------------------------------------------------------------
// ExecutionRegistry reads
// ---------------------------------------------------------------------

export async function getProviderOfSigner(contracts: Contracts, signer: string): Promise<string> {
  return contracts.executionRegistry.providerOfSigner(signer);
}

export async function getProviderMode(contracts: Contracts, provider: string): Promise<ProviderMode> {
  return Number(await contracts.executionRegistry.providerMode(provider)) as ProviderMode;
}

export async function isExecutionConsumed(contracts: Contracts, executionId: string): Promise<boolean> {
  return contracts.executionRegistry.executionConsumed(executionId);
}

export async function getProofValidityWindow(contracts: Contracts): Promise<bigint> {
  return contracts.executionRegistry.proofValidityWindow();
}

export async function computeExecutionId(
  contracts: Contracts,
  provider: string,
  modelId: string,
  requestHash: string,
  responseHash: string
): Promise<string> {
  return contracts.executionRegistry.hashExecutionId(provider, modelId, requestHash, responseHash);
}

/** Convenience: is `provider` both registered (via any signer) and
 *  currently in CascadeWrapper mode? Two reads combined for a common
 *  question — "would a usage proof from this provider be eligible for
 *  Level 1?" — see docs/protocol-spec.md §5-6 for what that is and isn't. */
export async function describeProviderConfidence(
  contracts: Contracts,
  provider: string
): Promise<{ mode: ProviderMode; isCascadeWrapper: boolean }> {
  const mode = await getProviderMode(contracts, provider);
  return { mode, isCascadeWrapper: mode === ProviderMode.CascadeWrapper };
}

// ---------------------------------------------------------------------
// AttributionSettlement reads
// ---------------------------------------------------------------------

export async function getAttributionFeePerExecution(contracts: Contracts): Promise<bigint> {
  return contracts.attributionSettlement.attributionFeePerExecution();
}

export async function getCurrentEpoch(contracts: Contracts): Promise<bigint> {
  return contracts.attributionSettlement.currentEpoch();
}

export async function getClaimable(contracts: Contracts, owner: string): Promise<bigint> {
  return contracts.attributionSettlement.claimable(owner);
}

export async function getMaxAncestorsPerSettlement(contracts: Contracts): Promise<bigint> {
  return contracts.attributionSettlement.maxAncestorsPerSettlement();
}

// ---------------------------------------------------------------------
// TrainingProvenanceRegistry reads
// ---------------------------------------------------------------------

export async function hasProvenance(contracts: Contracts, childModelId: string): Promise<boolean> {
  return contracts.trainingProvenanceRegistry.provenanceExists(childModelId);
}

export async function getProvenance(contracts: Contracts, childModelId: string): Promise<TrainingProvenance> {
  return toTrainingProvenance(await contracts.trainingProvenanceRegistry.getProvenance(childModelId));
}

export async function getEvidenceHash(contracts: Contracts, childModelId: string): Promise<string> {
  return contracts.trainingProvenanceRegistry.evidenceHashOf(childModelId);
}

export async function matchesEdge(
  contracts: Contracts,
  childModelId: string,
  expectedBaseModelId: string,
  expectedEvidenceHash: string
): Promise<boolean> {
  return contracts.trainingProvenanceRegistry.matchesEdge(childModelId, expectedBaseModelId, expectedEvidenceHash);
}

