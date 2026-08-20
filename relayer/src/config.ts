/**
 * Environment-driven configuration. No secrets are hardcoded or committed
 * — see relayer/.env.example for the documented variable list. Production
 * deployments should replace RELAYER_PRIVATE_KEY with a KMS/HSM-backed
 * signer implementing the same TransactionSigner interface (see signer.ts)
 * — that abstraction boundary exists specifically so this file does not
 * need to change to support it.
 */

export interface RelayerConfig {
  rpcUrl: string;
  chainId: bigint;
  cascadeRegistryAddress: string;
  executionRegistryAddress: string;
  attributionSettlementAddress: string;
  /** Dev/test only. Production should use an external signer — see signer.ts. */
  privateKey?: string;
  httpPort: number;
  confirmations: number;
  confirmationTimeoutMs: number;
  maxSubmissionAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  gasBumpPerAttempt: number; // e.g. 0.2 == +20% maxFeePerGas per retry
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} must be a number, got: ${raw}`);
  return parsed;
}

export function loadConfig(): RelayerConfig {
  return {
    rpcUrl: requireEnv("RPC_URL"),
    chainId: BigInt(requireEnv("CHAIN_ID")),
    cascadeRegistryAddress: requireEnv("CASCADE_REGISTRY_ADDRESS"),
    executionRegistryAddress: requireEnv("EXECUTION_REGISTRY_ADDRESS"),
    attributionSettlementAddress: requireEnv("ATTRIBUTION_SETTLEMENT_ADDRESS"),
    privateKey: process.env.RELAYER_PRIVATE_KEY,
    httpPort: envInt("HTTP_PORT", 8787),
    confirmations: envInt("CONFIRMATIONS", 1),
    confirmationTimeoutMs: envInt("CONFIRMATION_TIMEOUT_MS", 60_000),
    maxSubmissionAttempts: envInt("MAX_SUBMISSION_ATTEMPTS", 5),
    retryBaseDelayMs: envInt("RETRY_BASE_DELAY_MS", 1_000),
    retryMaxDelayMs: envInt("RETRY_MAX_DELAY_MS", 30_000),
    gasBumpPerAttempt: envInt("GAS_BUMP_PER_ATTEMPT", 20) / 100,
  };
}
