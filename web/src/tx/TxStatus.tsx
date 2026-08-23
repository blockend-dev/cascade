import React from "react";
import { TxState } from "./useTx";
import { AppConfig, explorerTxUrl } from "../config";
import { Hex } from "../components/primitives";

export function TxStatus({ state, config }: { state: TxState; config: AppConfig }) {
  if (state.status === "idle") return null;
  if (state.status === "pending") {
    return (
      <div className="tx-status tx-status-pending" role="status" aria-live="polite">
        Waiting for wallet confirmation and on-chain inclusion…
      </div>
    );
  }
  if (state.status === "confirmed") {
    const url = explorerTxUrl(config, state.hash);
    return (
      <div className="tx-status tx-status-confirmed" role="status">
        Confirmed — <Hex value={state.hash} />
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer">
            {" "}
            view on explorer ↗
          </a>
        )}
      </div>
    );
  }
  return (
    <div className="tx-status tx-status-failed" role="alert">
      <p>{state.error.message}</p>
      <details>
        <summary>Technical details</summary>
        <pre>{state.error.raw}</pre>
      </details>
    </div>
  );
}

/** Shown before the wallet prompt appears — states, in plain language,
 *  what the pending transaction will do (docs/frontend.md §6). */
export function TxSummary({ children }: { children: React.ReactNode }) {
  return (
    <div className="tx-summary" role="group" aria-label="Pending transaction summary">
      {children}
    </div>
  );
}
