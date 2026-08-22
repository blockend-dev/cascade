import { Contracts } from "./contracts";
import { getModel, getProviderMode } from "./read";
import { ProviderMode } from "./types";

/**
 * Read-only helpers about wrapper deployments — not the wrapper itself.
 * `wrapper/` is a Node process with its own lifecycle (download, verify,
 * load, serve); none of that belongs in a client SDK, and this module
 * does not attempt to reimplement or invoke it. What genuinely is an SDK
 * concern: letting an integrator ask, from the chain alone, "what
 * commitment would a correctly-configured wrapper for this model be
 * required to serve" and "is this provider even claiming Level 1" —
 * useful for dashboards/tooling without importing wrapper/src directly.
 */

/** The exact content-addressed commitment a wrapper instance configured
 *  for `modelId` must download and verify before serving — mirrors what
 *  wrapper/src/lifecycle.ts reads internally, exposed here as a read-only
 *  query so tooling doesn't need to run the wrapper to know it. */
export async function getRequiredModelCommitment(contracts: Contracts, modelId: string): Promise<string> {
  const model = await getModel(contracts, modelId);
  return model.modelCommitment;
}

export interface WrapperEligibility {
  provider: string;
  mode: ProviderMode;
  isCascadeWrapperMode: boolean;
}

/** Whether `provider` is currently registered in CascadeWrapper mode.
 *  Reminder, not enforced by this function: that flag is owner-attested,
 *  backed by wrapper/MEASUREMENT.md's off-chain verification procedure,
 *  not a cryptographic guarantee the chain itself checks — see
 *  docs/trust-model.md before treating a `true` result as more than
 *  that. */
export async function getWrapperEligibility(contracts: Contracts, provider: string): Promise<WrapperEligibility> {
  const mode = await getProviderMode(contracts, provider);
  return { provider, mode, isCascadeWrapperMode: mode === ProviderMode.CascadeWrapper };
}
