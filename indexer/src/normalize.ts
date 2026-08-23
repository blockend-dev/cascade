import { ethers } from "ethers";
import {
  CASCADE_REGISTRY_ABI,
  EXECUTION_REGISTRY_ABI,
  ATTRIBUTION_SETTLEMENT_ABI,
  TRAINING_PROVENANCE_REGISTRY_ABI,
} from "../../sdk/src/abis";
import { CascadeAddresses } from "../../sdk/src/types";
import { RawLogBatch } from "./ingestion";
import { CanonicalEvent, UNPROJECTED_EVENT_NAMES } from "./types";

/**
 * NORMALIZATION — converts raw logs into canonical Cascade events.
 * Reuses the SDK's generated ABIs (sdk/src/abis, themselves generated
 * from contracts/artifacts — ADR 0012) rather than hand-maintaining a
 * third copy of every event signature.
 */

const CONTRACT_ABIS: Record<string, readonly unknown[]> = {
  CascadeRegistry: CASCADE_REGISTRY_ABI,
  ExecutionRegistry: EXECUTION_REGISTRY_ABI,
  AttributionSettlement: ATTRIBUTION_SETTLEMENT_ABI,
  TrainingProvenanceRegistry: TRAINING_PROVENANCE_REGISTRY_ABI,
};

export interface ContractCatalogEntry {
  name: string;
  address: string;
  iface: ethers.Interface;
}

/** Builds the address -> {name, Interface} lookup once per indexer
 *  instance. Addresses are lowercased for lookup since callers may
 *  configure addresses in either case. */
export function buildContractCatalog(addresses: CascadeAddresses): Map<string, ContractCatalogEntry> {
  const entries: Array<[string, string]> = [
    ["CascadeRegistry", addresses.cascadeRegistry],
    ["ExecutionRegistry", addresses.executionRegistry],
    ["AttributionSettlement", addresses.attributionSettlement],
    ["TrainingProvenanceRegistry", addresses.trainingProvenanceRegistry],
  ];
  const catalog = new Map<string, ContractCatalogEntry>();
  for (const [name, address] of entries) {
    catalog.set(address.toLowerCase(), {
      name,
      address,
      iface: new ethers.Interface(CONTRACT_ABIS[name] as ethers.InterfaceAbi),
    });
  }
  return catalog;
}

/** Decodes a raw log batch into sorted, canonical events — the
 *  deterministic order `(blockNumber, logIndex)` every downstream
 *  consumer (projection, replay, reorg rollback) relies on. */
export function normalize(
  batch: RawLogBatch,
  chainId: bigint,
  catalog: Map<string, ContractCatalogEntry>
): CanonicalEvent[] {
  const decoded: CanonicalEvent[] = [];

  for (const log of batch.logs) {
    const entry = catalog.get(log.address.toLowerCase());
    if (!entry) continue; // defensive: getLogs's own address filter should prevent this

    let parsed: ethers.LogDescription | null;
    try {
      parsed = entry.iface.parseLog(log);
    } catch {
      parsed = null;
    }
    if (!parsed) continue; // an address-matching log this ABI can't decode — never fabricate a payload for it
    if (UNPROJECTED_EVENT_NAMES.has(parsed.name)) continue; // decoded but deliberately not projected — docs/indexer.md §4

    const payload = payloadFor(parsed.name, parsed.args);
    if (!payload) continue; // unrecognized event name — see payloadFor's own comment

    decoded.push({
      chainId,
      contractAddress: entry.address,
      eventName: parsed.name as CanonicalEvent["eventName"],
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
      blockTimestamp: batch.blockTimestamps.get(log.blockNumber) ?? 0,
      transactionHash: log.transactionHash,
      transactionIndex: log.transactionIndex ?? null,
      logIndex: log.index,
      payload,
    } as unknown as CanonicalEvent);
  }

  decoded.sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
  return decoded;
}

/**
 * Maps a decoded ethers `Result` to this package's plain canonical
 * payload shape, one case per event this indexer projects or otherwise
 * cares about (docs/indexer.md §1). Returns `null` for any event name
 * not in this list — deliberately narrow rather than a generic
 * "spread whatever ethers decoded" fallback, so a future contract
 * change that adds a new event is a visible gap here, not a silently
 * passed-through unknown shape.
 */
function payloadFor(name: string, args: ethers.Result): Record<string, unknown> | null {
  switch (name) {
    case "ModelRegistered":
      return { modelId: args.modelId, owner: args.owner, modelCommitment: args.modelCommitment, metadataURI: args.metadataURI };
    case "ModelMetadataUpdated":
      return { modelId: args.modelId, metadataURI: args.metadataURI };
    case "ModelOwnershipTransferred":
      return { modelId: args.modelId, previousOwner: args.previousOwner, newOwner: args.newOwner };
    case "ModelRevoked":
      return { modelId: args.modelId };
    case "LineageEdgeRegistered":
      return {
        edgeId: args.edgeId,
        childModelId: args.childModelId,
        parentModelId: args.parentModelId,
        confidenceLevel: Number(args.confidenceLevel),
        royaltyBps: Number(args.royaltyBps),
        stake: args.stake as bigint,
      };
    case "LineageEdgeChallenged":
      return { edgeId: args.edgeId, challenger: args.challenger, bond: args.bond as bigint };
    case "LineageEdgeResolved":
      return { edgeId: args.edgeId, challengeUpheld: args.challengeUpheld as boolean };
    case "LineageEdgeFinalized":
      return { edgeId: args.edgeId };
    case "SignerRegistered":
      return { provider: args.provider, signer: args.signer };
    case "SignerRevoked":
      return { provider: args.provider, signer: args.signer };
    case "ProviderModeUpdated":
      return { provider: args.provider, mode: Number(args.mode) };
    case "UsageProofConsumed":
      return { executionId: args.executionId, provider: args.provider, modelId: args.modelId, requestHash: args.requestHash };
    case "ExecutionSettled":
      return {
        executionId: args.executionId,
        modelId: args.modelId,
        provider: args.provider,
        epoch: args.epoch as bigint,
        amount: args.amount as bigint,
        servingConfidence: Number(args.servingConfidence),
      };
    case "EdgeAttributed":
      return {
        executionId: args.executionId,
        edgeId: args.edgeId,
        childModelId: args.childModelId,
        parentModelId: args.parentModelId,
        amount: args.amount as bigint,
        effectiveConfidence: Number(args.effectiveConfidence),
      };
    case "OwnerCredited":
      return { executionId: args.executionId, modelId: args.modelId, owner: args.owner, amount: args.amount as bigint };
    case "Claimed":
      return { recipient: args.recipient, amount: args.amount as bigint };
    case "ProvenanceRegistered":
      return {
        childModelId: args.childModelId,
        baseModelId: args.baseModelId,
        provider: args.provider,
        registrant: args.registrant,
        commitment: args.commitment,
        taskId: args.taskId,
      };
    default:
      return null;
  }
}
