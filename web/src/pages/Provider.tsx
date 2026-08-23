import React from "react";
import { useIndexer } from "../api/IndexerContext";
import { useAsync } from "../hooks/useAsync";
import { LoadingState, ErrorState, EmptyState, Hex, Panel } from "../components/primitives";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { DataFreshness } from "../components/DataFreshness";
import { Link } from "../router";
import { ProviderMode } from "../../../sdk/src/types";

export function Provider({ address }: { address: string }) {
  const indexer = useIndexer();
  const providerState = useAsync(() => indexer.getProvider(address), [indexer, address]);
  const signersState = useAsync(() => indexer.getProviderSigners(address), [indexer, address]);
  const executionsState = useAsync(() => indexer.listExecutionsByProvider(address, { limit: 20 }), [indexer, address]);

  return (
    <div className="page page-provider">
      <DataFreshness />
      <Panel title="Provider" id="provider-heading">
        <dl className="identity-grid">
          <dt>Address</dt>
          <dd>
            <Hex value={address} chars={12} />
          </dd>
          <dt>Mode</dt>
          <dd>
            {providerState.status === "ready" ? (
              providerState.data.mode === ProviderMode.CascadeWrapper ? (
                <span>
                  Cascade Wrapper — <strong>eligible</strong> to serve at Cryptographically Bound confidence. This
                  reflects the owner-attested mode flag, not a live attestation check — see{" "}
                  <a href="#/about">the protocol page</a> and <code>wrapper/MEASUREMENT.md</code> for how to
                  independently verify a specific running instance. "Eligible" is not the same as "currently
                  attested."
                </span>
              ) : (
                "Standard — executions from this provider are recorded at Declared serving confidence."
              )
            ) : (
              "—"
            )}
          </dd>
          <dt>Registered signers</dt>
          <dd>{providerState.status === "ready" ? providerState.data.signerCount : "—"}</dd>
        </dl>
      </Panel>

      <Panel title="Registered signers" id="signers-heading">
        {signersState.status === "loading" && <LoadingState label="Loading signers…" />}
        {signersState.status === "ready" && signersState.data.length === 0 && (
          <EmptyState label="No signers currently registered to this provider." />
        )}
        {signersState.status === "ready" && signersState.data.length > 0 && (
          <ul className="signer-list">
            {signersState.data.map((s) => (
              <li key={s.signer}>
                <Hex value={s.signer} /> — {s.active ? "active" : "revoked"}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Execution history" id="provider-executions-heading">
        {executionsState.status === "loading" && <LoadingState label="Loading executions…" />}
        {executionsState.status === "error" && (
          <ErrorState label="Could not load this provider's executions." detail={String(executionsState.error)} />
        )}
        {executionsState.status === "ready" && executionsState.data.items.length === 0 && (
          <EmptyState label="No executions recorded for this provider yet." />
        )}
        {executionsState.status === "ready" && executionsState.data.items.length > 0 && (
          <table className="execution-list">
            <thead>
              <tr>
                <th scope="col">Execution</th>
                <th scope="col">Model</th>
                <th scope="col">Serving confidence</th>
              </tr>
            </thead>
            <tbody>
              {executionsState.data.items.map((e) => (
                <tr key={e.executionId}>
                  <td>
                    <Link to={`/executions/${e.executionId}`}>
                      <Hex value={e.executionId} />
                    </Link>
                  </td>
                  <td>{e.modelId ? <Link to={`/models/${e.modelId}`}><Hex value={e.modelId} /></Link> : "—"}</td>
                  <td>
                    {e.servingConfidence !== null ? (
                      <ConfidenceBadge axis="Serving" level={e.servingConfidence} compact />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
