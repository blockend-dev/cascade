import { AppConfig } from "./types";

/**
 * Build-time, environment-driven configuration — never a URL/query
 * parameter (docs/frontend.md §8's security requirement: contract
 * addresses and chain ID are configuration-driven, not user-controlled).
 * Mirrors relayer/src/config.ts and indexer/src/config.ts's own
 * env-driven convention. Uses Vite's `import.meta.env` — see types.ts
 * for why `AppConfig`'s shape lives in a separate, framework-agnostic
 * file rather than here.
 */
export type { AppConfig } from "./types";
export { explorerTxUrl, explorerAddressUrl } from "./types";

function env(name: string, fallback?: string): string {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${name}`);
}

export function loadAppConfig(): AppConfig {
  return {
    rpcUrl: env("VITE_RPC_URL", "http://127.0.0.1:8545"),
    chainId: BigInt(env("VITE_CHAIN_ID", "31337")),
    chainName: env("VITE_CHAIN_NAME", "Local"),
    indexerUrl: env("VITE_INDEXER_URL", "http://127.0.0.1:8788"),
    addresses: {
      cascadeRegistry: env("VITE_CASCADE_REGISTRY_ADDRESS"),
      executionRegistry: env("VITE_EXECUTION_REGISTRY_ADDRESS"),
      attributionSettlement: env("VITE_ATTRIBUTION_SETTLEMENT_ADDRESS"),
      trainingProvenanceRegistry: env("VITE_TRAINING_PROVENANCE_REGISTRY_ADDRESS"),
    },
    explorerBaseUrl: (import.meta.env as Record<string, string | undefined>).VITE_EXPLORER_BASE_URL || null,
  };
}
