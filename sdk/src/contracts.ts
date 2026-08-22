import { ethers } from "ethers";
import { ATTRIBUTION_SETTLEMENT_ABI } from "./abis/AttributionSettlement";
import { CASCADE_REGISTRY_ABI } from "./abis/CascadeRegistry";
import { EXECUTION_REGISTRY_ABI } from "./abis/ExecutionRegistry";
import { TRAINING_PROVENANCE_REGISTRY_ABI } from "./abis/TrainingProvenanceRegistry";
import { CascadeAddresses } from "./types";

/** All four contract instances, bound to whichever runner (provider for
 *  read-only, signer for read+write) the caller supplies. See client.ts —
 *  this module is the single place ABI + address + runner come together;
 *  every other module takes a `Contracts` instance rather than
 *  constructing its own. */
export interface Contracts {
  cascadeRegistry: ethers.Contract;
  executionRegistry: ethers.Contract;
  attributionSettlement: ethers.Contract;
  trainingProvenanceRegistry: ethers.Contract;
}

export function connectContracts(addresses: CascadeAddresses, runner: ethers.ContractRunner): Contracts {
  return {
    cascadeRegistry: new ethers.Contract(addresses.cascadeRegistry, CASCADE_REGISTRY_ABI, runner),
    executionRegistry: new ethers.Contract(addresses.executionRegistry, EXECUTION_REGISTRY_ABI, runner),
    attributionSettlement: new ethers.Contract(addresses.attributionSettlement, ATTRIBUTION_SETTLEMENT_ABI, runner),
    trainingProvenanceRegistry: new ethers.Contract(
      addresses.trainingProvenanceRegistry,
      TRAINING_PROVENANCE_REGISTRY_ABI,
      runner
    ),
  };
}
