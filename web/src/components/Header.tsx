import React from "react";
import { Link } from "../router";
import { useWallet } from "../wallet/WalletContext";
import { AppConfig } from "../config";
import { Hex } from "./primitives";

export function Header({ config }: { config: AppConfig }) {
  const { account, isWrongChain, isConnecting, error, connect, disconnect } = useWallet();

  return (
    <header className="app-header">
      <div className="app-header-brand">
        <Link to="/" className="brand-link">
          Cascade
        </Link>
        <span className="brand-subtitle">Model provenance &amp; attribution explorer</span>
      </div>
      <nav aria-label="Primary">
        <Link to="/">Models</Link>
        <Link to="/dashboard">Dashboard</Link>
        <Link to="/about">Protocol</Link>
      </nav>
      <div className="wallet-controls">
        {account ? (
          <>
            {isWrongChain && (
              <span className="wrong-chain-warning" role="alert">
                Wrong network — connect to {config.chainName} (chain {config.chainId.toString()})
              </span>
            )}
            <span className="wallet-account">
              <Hex value={account} />
            </span>
            <button type="button" onClick={disconnect}>
              Disconnect
            </button>
          </>
        ) : (
          <button type="button" onClick={connect} disabled={isConnecting}>
            {isConnecting ? "Connecting…" : "Connect wallet"}
          </button>
        )}
        {error && (
          <span className="wallet-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </header>
  );
}
