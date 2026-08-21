import * as path from "node:path";
import { ethers } from "ethers";
import { CASCADE_REGISTRY_ABI } from "./abi";
import { ModelBackend, StorageClient, WrapperConfig } from "./types";

export class ModelNotFoundError extends Error {}
export class ModelNotActiveError extends Error {}
export class VerificationFailedError extends Error {}

/**
 * The whole point of Phase 7, in one function: read the *registered*
 * commitment for `config.modelId` from CascadeRegistry — never a
 * separately-configurable value, so there is nothing to mismatch by
 * misconfiguration — download exactly that content-addressed hash with
 * proof verification on, and only then load it. Any failure at any step
 * throws; nothing downstream of this function ever runs against
 * unverified content.
 *
 * Explicitly does not, and must not, accept a model path, alias, or
 * commitment as a runtime parameter from anywhere other than the chain
 * read below — see docs/threat-model.md #19 ("no mutable alias") and #20
 * ("no runtime model switching").
 */
export async function verifyAndLoad(
  config: WrapperConfig,
  provider: ethers.Provider,
  storage: StorageClient,
  backend: ModelBackend
): Promise<{ modelCommitment: string; modelPath: string }> {
  const cascadeRegistry = new ethers.Contract(config.cascadeRegistryAddress, CASCADE_REGISTRY_ABI, provider);

  let model: { owner: string; modelCommitment: string; status: bigint };
  try {
    model = await cascadeRegistry.getModel(config.modelId);
  } catch (err) {
    throw new ModelNotFoundError(
      `CascadeRegistry has no model registered for modelId ${config.modelId}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const ACTIVE = 0n;
  if (model.status !== ACTIVE) {
    throw new ModelNotActiveError(`Model ${config.modelId} is not Active (status=${model.status}) — refusing to serve`);
  }

  const modelCommitment = model.modelCommitment;
  const modelPath = path.join(config.cacheDir, modelCommitment.replace(/^0x/, ""));

  const result = await storage.downloadVerified(modelCommitment, modelPath);
  if (!result.ok) {
    throw new VerificationFailedError(
      `0G Storage download/proof verification failed for commitment ${modelCommitment}: ${result.error ?? "unknown error"}`
    );
  }

  await backend.load(modelPath); // throws on failure — propagates, never swallowed

  return { modelCommitment, modelPath };
}
