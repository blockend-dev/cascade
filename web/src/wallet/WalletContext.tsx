import { ethers } from "ethers";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createCascadeClient, CascadeClient } from "../../../sdk/src/client";
import { AppConfig } from "../config";

/**
 * Wallet connection — hand-rolled against `window.ethereum` (EIP-1193),
 * per ADR 0015 (no wallet-connection library). The resulting
 * `CascadeClient` is always available: read-only (backed by
 * `config.rpcUrl` via a plain `JsonRpcProvider`) when no wallet is
 * connected, signer-bound once one is. Every write flow in this app
 * goes through `client.write`/`client.usage` — never a hand-rolled
 * transaction.
 */

interface EthereumProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeListener(event: string, handler: (...args: unknown[]) => void): void;
}

function getInjectedProvider(): EthereumProvider | null {
  const w = window as unknown as { ethereum?: EthereumProvider };
  return w.ethereum ?? null;
}

export interface WalletState {
  account: string | null;
  chainId: bigint | null;
  isWrongChain: boolean;
  isConnecting: boolean;
  error: string | null;
  client: CascadeClient;
  connect: () => Promise<void>;
  disconnect: () => void;
}

// Exported (not just the hook) so tests can render a subtree with a
// hand-constructed WalletState via `<WalletContext.Provider value={...}>`
// without needing a real `window.ethereum`/ethers provider — see
// web/test/Header.test.tsx.
export const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ config, children }: { config: AppConfig; children: React.ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<bigint | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);

  const readProvider = useMemo(() => new ethers.JsonRpcProvider(config.rpcUrl, undefined, { staticNetwork: true }), [config.rpcUrl]);

  const client = useMemo(
    () => createCascadeClient({ provider: readProvider, signer: signer ?? undefined, addresses: config.addresses }),
    [readProvider, signer, config.addresses]
  );

  const connect = useCallback(async () => {
    const injected = getInjectedProvider();
    if (!injected) {
      setError("No wallet extension detected. Install a browser wallet (e.g. MetaMask) to connect.");
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      const accounts = (await injected.request({ method: "eth_requestAccounts" })) as string[];
      // Read the chain ID directly from the injected provider rather than
      // through ethers' BrowserProvider.getNetwork() — for chains outside
      // ethers' built-in network registry (0G mainnet included),
      // getNetwork() has been observed to resolve a stale cached value
      // instead of re-querying the wallet. eth_chainId always reflects
      // the wallet's current network, matching onChainChanged below.
      const hexChainId = (await injected.request({ method: "eth_chainId" })) as string;
      const browserProvider = new ethers.BrowserProvider(injected as unknown as ethers.Eip1193Provider);
      setAccount(accounts[0] ?? null);
      setChainId(BigInt(hexChainId));
      setSigner(await browserProvider.getSigner());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet connection was rejected.");
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAccount(null);
    setChainId(null);
    setSigner(null);
  }, []);

  useEffect(() => {
    const injected = getInjectedProvider();
    if (!injected) return;
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (accounts.length === 0) disconnect();
      else setAccount(accounts[0]);
    };
    const onChainChanged = (...args: unknown[]) => {
      const hexChainId = args[0] as string;
      setChainId(BigInt(hexChainId));
    };
    injected.on("accountsChanged", onAccountsChanged);
    injected.on("chainChanged", onChainChanged);
    return () => {
      injected.removeListener("accountsChanged", onAccountsChanged);
      injected.removeListener("chainChanged", onChainChanged);
    };
  }, [disconnect]);

  const isWrongChain = chainId !== null && chainId !== config.chainId;

  const value: WalletState = { account, chainId, isWrongChain, isConnecting, error, client, connect, disconnect };
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet() called outside <WalletProvider>");
  return ctx;
}
