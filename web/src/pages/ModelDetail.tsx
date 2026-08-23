import React from "react";
import { useIndexer } from "../api/IndexerContext";
import { useWallet } from "../wallet/WalletContext";
import { useAsync } from "../hooks/useAsync";
import { LoadingState, ErrorState, EmptyState, Hex, ExternalLink, Panel } from "../components/primitives";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { DataFreshness } from "../components/DataFreshness";
import { fetchLineageSubgraph } from "../lineage/fetchSubgraph";
import { layoutDag } from "../lineage/layout";
import { LineageGraph } from "../lineage/LineageGraph";
import { Link } from "../router";
import { ConfidenceLevel } from "../confidence";
import { EdgeActions } from "../components/EdgeActions";
import { AppConfig } from "../types";

export function ModelDetail({ modelId, config }: { modelId: string; config: AppConfig }) {
  const indexer = useIndexer();
  const { client } = useWallet();

  const modelState = useAsync(() => indexer.getModel(modelId), [indexer, modelId]);
  const lineageState = useAsync(() => indexer.getModelLineage(modelId), [indexer, modelId]);
  const provenanceState = useAsync(() => indexer.getTrainingProvenance(modelId), [indexer, modelId]);
  const executionsState = useAsync(() => indexer.listExecutionsByModel(modelId, { limit: 10 }), [indexer, modelId]);
  const subgraphState = useAsync(() => fetchLineageSubgraph(indexer, modelId), [indexer, modelId]);

  // Live, direct contract cross-check (docs/frontend.md §5) — never
  // trusted in place of the indexed value, only shown alongside it.
  const liveCheckState = useAsync(async () => {
    const [liveModel, requiredCommitment] = await Promise.all([
      client.read.getModel(modelId).catch(() => null),
      client.wrapperInfo.getRequiredModelCommitment(modelId).catch(() => null),
    ]);
    return { liveModel, requiredCommitment };
  }, [client, modelId]);

  if (modelState.status === "loading") return <LoadingState label="Loading model…" />;
  if (modelState.status === "error") return <ErrorState label="Could not load this model from the indexer." detail={String(modelState.error)} />;
  if (!modelState.data) return <EmptyState label={`No model indexed with ID ${modelId}.`} />;

  const model = modelState.data;

  return (
    <div className="page page-model-detail">
      <DataFreshness />

      <Panel title="Identity" id="identity-heading">
        <dl className="identity-grid">
          <dt>Model ID</dt>
          <dd>
            <Hex value={model.modelId} chars={12} />
          </dd>
          <dt>Owner</dt>
          <dd>
            <Hex value={model.owner} />
          </dd>
          <dt>Weight commitment</dt>
          <dd>
            <Hex value={model.modelCommitment} chars={12} />
          </dd>
          <dt>Metadata</dt>
          <dd>
            <ExternalLink href={model.metadataURI}>{model.metadataURI || "(none)"}</ExternalLink>
          </dd>
          <dt>Status</dt>
          <dd>
            <span className={`status-pill status-${model.status.toLowerCase()}`}>{model.status}</span>
          </dd>
          <dt>Registered</dt>
          <dd>block {model.createdAtBlock.toLocaleString()}</dd>
        </dl>
      </Panel>

      <Panel title="Verification" id="verification-heading">
        <p className="verification-intro">
          What Cascade actually checks for this model: registered commitment → wrapper reads commitment → model
          retrieved from 0G Storage → content/proof verification → weights verified → model loaded → serving occurs
          inside the attested environment. Cascade's own wrapper (Level 1) verifies the download against the
          registered commitment before loading; it does <strong>not</strong> itself verify the TDX/GPU attestation
          quote — that binding is 0G's Compute Network and TEE hardware's own responsibility, inherited here, not
          independently re-checked by this frontend or by Cascade's contracts. See{" "}
          <a href="#/about">the protocol page</a> and{" "}
          <code>wrapper/MEASUREMENT.md</code> for the reproducible-build/attestation runbook a technically
          sophisticated user can run independently.
        </p>
        {liveCheckState.status === "ready" && liveCheckState.data.liveModel && (
          <div className="live-cross-check">
            <h4>Indexed vs. live commitment</h4>
            <p>
              Indexed: <Hex value={model.modelCommitment} chars={12} /> — Live (direct contract read):{" "}
              <Hex value={liveCheckState.data.liveModel.modelCommitment} chars={12} />
              {liveCheckState.data.liveModel.modelCommitment === model.modelCommitment ? (
                <span className="live-match"> — match</span>
              ) : (
                <span className="live-mismatch"> — MISMATCH: the indexer is stale, do not rely on the indexed value</span>
              )}
            </p>
          </div>
        )}
      </Panel>

      <Panel title="Lineage confidence" id="lineage-heading">
        {lineageState.status === "loading" && <LoadingState label="Loading lineage…" />}
        {lineageState.status === "ready" && lineageState.data.parents.length === 0 && (
          <EmptyState label="No parent lineage declared — this model has no registered ancestry." />
        )}
        {lineageState.status === "ready" &&
          lineageState.data.parents.map((edge) => (
            <div key={edge.edgeId} className="lineage-edge-summary">
              <Link to={`/models/${edge.parentModelId}`}>
                parent <Hex value={edge.parentModelId} />
              </Link>{" "}
              — {(edge.royaltyBps / 100).toFixed(2)}% royalty — status {edge.status}
              <ConfidenceBadge axis="Lineage" level={edge.confidenceLevel} compact />
              <EdgeActions edge={edge} config={config} />
            </div>
          ))}

        {subgraphState.status === "ready" && subgraphState.data.edges.length > 0 && (
          <LineageGraph layout={layoutDag(modelId, subgraphState.data.models, subgraphState.data.edges)} focalModelId={modelId} />
        )}
      </Panel>

      <Panel title="Training provenance (Level 2)" id="provenance-heading">
        {provenanceState.status === "loading" && <LoadingState label="Loading provenance…" />}
        {provenanceState.status === "ready" && !provenanceState.data && (
          <EmptyState label="No Level 2 training provenance registered for this model." />
        )}
        {provenanceState.status === "ready" && provenanceState.data && (
          <>
            <p className="provenance-caveat">
              A registered record is circumstantial, accountable evidence — a real, identifiable provider is on the
              hook for having signed it — <strong>not</strong> a cryptographic proof that the provider's enclave
              actually computed this output from these inputs.
            </p>
            <dl className="identity-grid">
              <dt>Base model</dt>
              <dd>
                <Link to={`/models/${provenanceState.data.baseModelId}`}>
                  <Hex value={provenanceState.data.baseModelId} />
                </Link>
              </dd>
              <dt>Provider</dt>
              <dd>
                <Link to={`/providers/${provenanceState.data.provider}`}>
                  <Hex value={provenanceState.data.provider} />
                </Link>
              </dd>
              <dt>Registrant</dt>
              <dd>
                <Hex value={provenanceState.data.registrant} />
              </dd>
              <dt>0G task ID</dt>
              <dd>
                <Hex value={provenanceState.data.taskId} />
              </dd>
              <dt>Commitment (dataset/script/base/result hash)</dt>
              <dd>
                <Hex value={provenanceState.data.commitment} chars={12} />
                <br />
                <em>
                  Individual dataset root / training script hash / evidence URI fields are not emitted by the
                  protocol event and are not indexed — available only via a direct contract read
                  (<code>TrainingProvenanceRegistry.getProvenance</code>).
                </em>
              </dd>
              <dt>Registered</dt>
              <dd>block {provenanceState.data.registeredAtBlock.toLocaleString()}</dd>
            </dl>
          </>
        )}
      </Panel>

      <Panel title="Attribution — recent executions" id="attribution-heading">
        {executionsState.status === "loading" && <LoadingState label="Loading executions…" />}
        {executionsState.status === "ready" && executionsState.data.items.length === 0 && (
          <EmptyState label="No executions have been settled against this model yet." />
        )}
        {executionsState.status === "ready" && executionsState.data.items.length > 0 && (
          <table className="execution-list">
            <thead>
              <tr>
                <th scope="col">Execution</th>
                <th scope="col">Provider</th>
                <th scope="col">Serving confidence</th>
                <th scope="col">Amount</th>
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
                  <td>{e.provider ? <Hex value={e.provider} /> : "—"}</td>
                  <td>
                    {e.servingConfidence !== null ? (
                      <ConfidenceBadge axis="Serving" level={e.servingConfidence as ConfidenceLevel} compact />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{e.amount !== null ? `${e.amount.toString()} wei` : "not yet settled"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
