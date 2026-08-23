import React, { useState } from "react";
import { useIndexer } from "../api/IndexerContext";
import { useWallet } from "../wallet/WalletContext";
import { useAsync } from "../hooks/useAsync";
import { LoadingState, ErrorState, EmptyState, Hex, Panel } from "../components/primitives";
import { DataFreshness } from "../components/DataFreshness";
import { useTx } from "../tx/useTx";
import { TxStatus, TxSummary } from "../tx/TxStatus";
import { Link } from "../router";
import { AppConfig } from "../config";
import { EdgeRow } from "../../../indexer/src/types";

export function OwnerDashboard({ config }: { config: AppConfig }) {
  const { account, client } = useWallet();
  const indexer = useIndexer();

  const modelsState = useAsync(
    () => (account ? indexer.listModelsByOwner(account, { limit: 50 }) : Promise.resolve(null)),
    [indexer, account]
  );

  const ownedModels = modelsState.status === "ready" ? modelsState.data : null;
  const edgesState = useAsync(async () => {
    if (!ownedModels) return [] as EdgeRow[];
    const perModel = await Promise.all(ownedModels.items.map((m: { modelId: string }) => indexer.getModelLineage(m.modelId)));
    return perModel.flatMap((l) => l.parents);
  }, [indexer, ownedModels]);

  // Claimable balance is security-sensitive — a LIVE read via the SDK,
  // not the indexed value, per docs/frontend.md §5.
  const claimableState = useAsync(
    () => (account ? client.read.getClaimable(account) : Promise.resolve(0n)),
    [client, account]
  );
  const claimsHistoryState = useAsync(
    () => (account ? indexer.getClaims(account) : Promise.resolve([])),
    [indexer, account]
  );

  const claimTx = useTx(() => client.write.claimAttribution());

  const [newModelCommitment, setNewModelCommitment] = useState("");
  const [newModelMetadata, setNewModelMetadata] = useState("");
  const registerTx = useTx((commitment: string, metadata: string) => client.write.registerModel(commitment, metadata));

  if (!account) {
    return (
      <div className="page page-dashboard">
        <EmptyState label="Connect a wallet to view your models, lineage edges, provenance records, and claimable attribution." />
      </div>
    );
  }

  return (
    <div className="page page-dashboard">
      <DataFreshness />

      <Panel title="Claimable attribution" id="claimable-heading">
        {claimableState.status === "loading" && <LoadingState label="Reading live claimable balance…" />}
        {claimableState.status === "ready" && (
          <>
            <p className="claimable-amount">{claimableState.data.toString()} wei (live, direct contract read)</p>
            {claimableState.data > 0n && (
              <>
                <TxSummary>Claim your entire claimable balance ({claimableState.data.toString()} wei) to your connected wallet.</TxSummary>
                <button type="button" onClick={() => claimTx.run()} disabled={claimTx.state.status === "pending"}>
                  Claim
                </button>
                <TxStatus state={claimTx.state} config={config} />
              </>
            )}
          </>
        )}

        <h4>Claim history</h4>
        {claimsHistoryState.status === "ready" && claimsHistoryState.data.length === 0 && (
          <EmptyState label="No claims recorded yet." />
        )}
        {claimsHistoryState.status === "ready" && claimsHistoryState.data.length > 0 && (
          <ul className="claim-history">
            {claimsHistoryState.data.map((c) => (
              <li key={`${c.blockNumber}-${c.transactionHash}`}>
                {c.amount.toString()} wei — block {c.blockNumber.toLocaleString()} — <Hex value={c.transactionHash} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Register a new model" id="register-heading">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            registerTx.run(newModelCommitment, newModelMetadata);
          }}
        >
          <label htmlFor="new-model-commitment">Weight commitment (bytes32)</label>
          <input
            id="new-model-commitment"
            type="text"
            required
            pattern="0x[0-9a-fA-F]{64}"
            value={newModelCommitment}
            onChange={(e) => setNewModelCommitment(e.target.value)}
          />
          <label htmlFor="new-model-metadata">Metadata URI</label>
          <input
            id="new-model-metadata"
            type="text"
            value={newModelMetadata}
            onChange={(e) => setNewModelMetadata(e.target.value)}
          />
          <TxSummary>
            Register a new model owned by <Hex value={account} /> with this commitment. A random salt is generated
            for you.
          </TxSummary>
          <button type="submit" disabled={registerTx.state.status === "pending"}>
            Register model
          </button>
        </form>
        <TxStatus state={registerTx.state} config={config} />
      </Panel>

      <Panel title="Your models" id="owned-models-heading">
        {modelsState.status === "loading" && <LoadingState label="Loading your models…" />}
        {modelsState.status === "error" && <ErrorState label="Could not load your models." detail={String(modelsState.error)} />}
        {modelsState.status === "ready" && modelsState.data && modelsState.data.items.length === 0 && (
          <EmptyState label="You don't own any registered models yet." />
        )}
        {modelsState.status === "ready" && modelsState.data && modelsState.data.items.length > 0 && (
          <ul className="owned-model-list">
            {modelsState.data.items.map((m) => (
              <li key={m.modelId}>
                <Link to={`/models/${m.modelId}`}>
                  <Hex value={m.modelId} />
                </Link>{" "}
                — <span className={`status-pill status-${m.status.toLowerCase()}`}>{m.status}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Your registered lineage edges" id="owned-edges-heading">
        {edgesState.status === "loading" && <LoadingState label="Loading lineage edges…" />}
        {edgesState.status === "ready" && edgesState.data.length === 0 && (
          <EmptyState label="No lineage edges registered for your models." />
        )}
        {edgesState.status === "ready" && edgesState.data.length > 0 && (
          <table className="edge-list">
            <thead>
              <tr>
                <th scope="col">Edge</th>
                <th scope="col">Parent</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {edgesState.data.map((e: EdgeRow) => (
                <tr key={e.edgeId}>
                  <td>
                    <Hex value={e.edgeId} />
                  </td>
                  <td>
                    <Link to={`/models/${e.parentModelId}`}>
                      <Hex value={e.parentModelId} />
                    </Link>
                  </td>
                  <td>{e.status === "Challenged" ? <strong>{e.status} ⚠</strong> : e.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
