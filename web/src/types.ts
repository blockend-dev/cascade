import { CascadeAddresses } from "../../sdk/src/types";

/**
 * `AppConfig`'s shape, kept separate from `config.ts`'s
 * `loadAppConfig()`. `config.ts` uses Vite-specific `import.meta.env`
 * syntax, which only compiles under an ESM-targeting `module` setting
 * — incompatible with being imported (even just for this type) into
 * `contracts/`'s CommonJS ts-node/Hardhat test context
 * (`contracts/test/web/`), which imports `indexerClient.ts` and other
 * plain data-layer modules directly to test them against a real chain.
 * Splitting the type out means those modules never need to load
 * `config.ts` itself, just this framework-agnostic file.
 */
export interface AppConfig {
  rpcUrl: string;
  chainId: bigint;
  chainName: string;
  indexerUrl: string;
  addresses: CascadeAddresses;
  explorerBaseUrl: string | null;
}

export function explorerTxUrl(config: AppConfig, txHash: string): string | null {
  return config.explorerBaseUrl ? `${config.explorerBaseUrl.replace(/\/$/, "")}/tx/${txHash}` : null;
}

export function explorerAddressUrl(config: AppConfig, address: string): string | null {
  return config.explorerBaseUrl ? `${config.explorerBaseUrl.replace(/\/$/, "")}/address/${address}` : null;
}
