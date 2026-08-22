import { ethers } from "ethers";
import { connectContracts, Contracts } from "./contracts";
import { decodeCascadeError, DecodedCascadeError } from "./errors";
import { trainingProvenanceClaimDomain, usageProofDomain, Eip712Domain } from "./eip712";
import * as read from "./read";
import * as usage from "./usage";
import * as write from "./write";
import * as wrapperInfo from "./wrapperInfo";
import { CascadeAddresses } from "./types";

export interface CascadeClientConfig {
  provider: ethers.Provider;
  /** Omit for a read-only client — every write/usage-submission function
   *  throws a clear error rather than a signer being silently required.
   *  See "sensible read-only usage without a signer" in the Phase 8
   *  brief. */
  signer?: ethers.Signer;
  addresses: CascadeAddresses;
}

/** Strips the leading `contracts: Contracts` parameter every read/write/
 *  usage/wrapperInfo function takes, since the client binds it via
 *  closure. Keeps `CascadeClient`'s method signatures in exact sync with
 *  the underlying module functions without hand-retyping each one —
 *  hand-retyping is exactly the class of drift ADR 0012 exists to avoid,
 *  now applied to this file too, not just the ABIs. */
type Bound<F> = F extends (contracts: Contracts, ...args: infer A) => infer R ? (...args: A) => R : never;

export interface CascadeClient {
  contracts: Contracts;
  chainId(): Promise<bigint>;
  usageProofDomain(): Promise<Eip712Domain>;
  trainingProvenanceClaimDomain(): Promise<Eip712Domain>;
  decodeError(error: unknown): DecodedCascadeError;

  read: {
    getModel: Bound<typeof read.getModel>;
    getEdge: Bound<typeof read.getEdge>;
    computeEdgeId: Bound<typeof read.computeEdgeId>;
    getParentEdgeIds: Bound<typeof read.getParentEdgeIds>;
    pathConfidence: Bound<typeof read.pathConfidence>;
    getCascadeRegistryParameters: Bound<typeof read.getCascadeRegistryParameters>;
    getProviderOfSigner: Bound<typeof read.getProviderOfSigner>;
    getProviderMode: Bound<typeof read.getProviderMode>;
    isExecutionConsumed: Bound<typeof read.isExecutionConsumed>;
    getProofValidityWindow: Bound<typeof read.getProofValidityWindow>;
    computeExecutionId: Bound<typeof read.computeExecutionId>;
    describeProviderConfidence: Bound<typeof read.describeProviderConfidence>;
    getAttributionFeePerExecution: Bound<typeof read.getAttributionFeePerExecution>;
    getCurrentEpoch: Bound<typeof read.getCurrentEpoch>;
    getClaimable: Bound<typeof read.getClaimable>;
    getMaxAncestorsPerSettlement: Bound<typeof read.getMaxAncestorsPerSettlement>;
    hasProvenance: Bound<typeof read.hasProvenance>;
    getProvenance: Bound<typeof read.getProvenance>;
    getEvidenceHash: Bound<typeof read.getEvidenceHash>;
    matchesEdge: Bound<typeof read.matchesEdge>;
  };

  write: {
    registerModel: Bound<typeof write.registerModel>;
    updateMetadataURI: Bound<typeof write.updateMetadataURI>;
    transferModelOwnership: Bound<typeof write.transferModelOwnership>;
    revokeModel: Bound<typeof write.revokeModel>;
    registerLineageEdge: Bound<typeof write.registerLineageEdge>;
    challengeEdge: Bound<typeof write.challengeEdge>;
    resolveChallenge: Bound<typeof write.resolveChallenge>;
    finalizeEdge: Bound<typeof write.finalizeEdge>;
    registerProviderSigner: Bound<typeof write.registerProviderSigner>;
    revokeProviderSigner: Bound<typeof write.revokeProviderSigner>;
    registerProvenance: Bound<typeof write.registerProvenance>;
    claimAttribution: Bound<typeof write.claimAttribution>;
  };

  usage: {
    verifyUsageProof: Bound<typeof usage.verifyUsageProof>;
    submitUsageProof: Bound<typeof usage.submitUsageProof>;
  };

  wrapperInfo: {
    getRequiredModelCommitment: Bound<typeof wrapperInfo.getRequiredModelCommitment>;
    getWrapperEligibility: Bound<typeof wrapperInfo.getWrapperEligibility>;
  };
}

/** Binds every function in `mod` to `contracts` as its first argument,
 *  matching the `Bound<>` type above exactly. One generic implementation
 *  instead of hand-writing each arrow function — the previous version of
 *  this file hand-wrote them and got the interface out of sync with the
 *  implementation (each bound function silently took `Contracts` as its
 *  first *visible* parameter instead of having it pre-applied). Doing
 *  this generically removes that entire failure mode rather than just
 *  fixing today's instance of it. */
function bindAll<M extends Record<string, (contracts: Contracts, ...args: never[]) => unknown>>(
  mod: M,
  contracts: Contracts
): { [K in keyof M]: Bound<M[K]> } {
  const bound = {} as { [K in keyof M]: Bound<M[K]> };
  for (const key of Object.keys(mod) as Array<keyof M>) {
    const fn = mod[key];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bound as any)[key] = (...args: unknown[]) => fn(contracts, ...(args as never[]));
  }
  return bound;
}

/**
 * The SDK's single entrypoint. Binds every read/write/usage/wrapperInfo
 * function to this client's contracts so callers write
 * `client.read.getModel(id)` rather than threading a `Contracts` object
 * through by hand. Nothing here adds protocol logic — this module is
 * composition only; see read.ts/write.ts/usage.ts/wrapperInfo.ts for the
 * actual (thin, wrapping) implementations.
 */
export function createCascadeClient(config: CascadeClientConfig): CascadeClient {
  const runner = config.signer ?? config.provider;
  const contracts = connectContracts(config.addresses, runner);

  const chainId = async () => (await config.provider.getNetwork()).chainId;

  return {
    contracts,
    chainId,
    usageProofDomain: async () => usageProofDomain(await chainId(), config.addresses.executionRegistry),
    trainingProvenanceClaimDomain: async () =>
      trainingProvenanceClaimDomain(await chainId(), config.addresses.trainingProvenanceRegistry),
    decodeError: (error: unknown) => decodeCascadeError(error, contracts),

    read: bindAll(read, contracts),
    write: bindAll(write, contracts),
    usage: bindAll(usage, contracts),
    wrapperInfo: bindAll(wrapperInfo, contracts),
  };
}
