import { AppConfig } from "../src/config";
import { WalletState } from "../src/wallet/WalletContext";
import { CascadeClient } from "../../sdk/src/client";

/**
 * Test-only fixtures — never imported from application code
 * (docs/frontend.md §9). These exist so component tests can render UI
 * behavior (loading/empty/error/wrong-chain states, form structure)
 * without a real wallet extension or a real running indexer server;
 * data-fetching CORRECTNESS against real indexed data is covered
 * separately in contracts/test/web/ against a real Hardhat chain.
 */

export function fakeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    rpcUrl: "http://127.0.0.1:8545",
    chainId: 31337n,
    chainName: "Test Chain",
    indexerUrl: "http://127.0.0.1:0",
    addresses: {
      cascadeRegistry: "0x1111111111111111111111111111111111111111",
      executionRegistry: "0x2222222222222222222222222222222222222222",
      attributionSettlement: "0x3333333333333333333333333333333333333333",
      trainingProvenanceRegistry: "0x4444444444444444444444444444444444444444",
    },
    explorerBaseUrl: null,
    ...overrides,
  };
}

export function fakeWalletState(overrides: Partial<WalletState> = {}): WalletState {
  return {
    account: null,
    chainId: null,
    isWrongChain: false,
    isConnecting: false,
    error: null,
    client: {} as CascadeClient,
    connect: async () => {},
    disconnect: () => {},
    ...overrides,
  };
}
