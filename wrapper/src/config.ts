import { WrapperConfig } from "./types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} must be a number, got: ${raw}`);
  return parsed;
}

export function loadConfig(): WrapperConfig {
  return {
    rpcUrl: requireEnv("RPC_URL"),
    cascadeRegistryAddress: requireEnv("CASCADE_REGISTRY_ADDRESS"),
    modelId: requireEnv("MODEL_ID"),
    storageIndexerUrl: requireEnv("STORAGE_INDEXER_URL"),
    httpPort: envInt("HTTP_PORT", 8090),
    cacheDir: process.env.CACHE_DIR ?? "./model-cache",
  };
}
