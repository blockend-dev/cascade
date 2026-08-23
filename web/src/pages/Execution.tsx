import React from "react";
import { useIndexer } from "../api/IndexerContext";
import { useAsync } from "../hooks/useAsync";
import { LoadingState, ErrorState, EmptyState, Hex, Panel } from "../components/primitives";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { DataFreshness } from "../components/DataFreshness";
import { Link } from "../router";
import { ConfidenceLevel } from "../confidence";

const NOT_EMITTED =
  "Not emitted by the protocol event; available only through direct contract verification (the original UsageProof, if you hold it).";

export function Execution({ executionId }: { executionId: string }) {
  const indexer = useIndexer();
  const executionState = useAsync(() => indexer.getExecution(executionId), [indexer, executionId]);
  const attributionState = useAsync(() => indexer.getExecutionAttribution(executionId), [indexer, executionId]);

  if (executionState.status === "loading") return <LoadingState label="Loading execution…" />;
  if (executionState.status === "error")
    return <ErrorState label="Could not load this execution from the indexer." detail={String(executionState.error)} />;
  if (!executionState.data) return <EmptyState label={`No execution indexed with ID ${executionId}.`} />;

  const execution = executionState.data;

  return (
    <div className="page page-execution">
      <DataFreshness />
      <Panel title="Execution" id="execution-heading">
        <dl className="identity-grid">
          <dt>Execution ID</dt>
          <dd>
            <Hex value={execution.executionId} chars={12} />
          </dd>
          <dt>Model</dt>
          <dd>{execution.modelId ? <Link to={`/models/${execution.modelId}`}><Hex value={execution.modelId} /></Link> : "—"}</dd>
          <dt>Provider</dt>
          <dd>{execution.provider ? <Link to={`/providers/${execution.provider}`}><Hex value={execution.provider} /></Link> : "—"}</dd>
          <dt>Epoch</dt>
          <dd>{execution.epoch !== null ? execution.epoch.toString() : "not yet settled"}</dd>
          <dt>Request hash</dt>
          <dd>{execution.requestHash ? <Hex value={execution.requestHash} chars={12} /> : "—"}</dd>
          <dt>Response hash</dt>
          <dd>
            <em>{NOT_EMITTED}</em>
          </dd>
          <dt>Serving confidence</dt>
          <dd>
            {execution.servingConfidence !== null ? (
              <ConfidenceBadge axis="Serving" level={execution.servingConfidence as ConfidenceLevel} />
            ) : (
              "not yet settled"
            )}
          </dd>
          <dt>Amount funded</dt>
          <dd>{execution.amount !== null ? `${execution.amount.toString()} wei` : "not yet settled"}</dd>
          <dt>Consumed at</dt>
          <dd>{execution.consumedAtBlock !== null ? `block ${execution.consumedAtBlock.toLocaleString()}` : "not consumed"}</dd>
          <dt>Settled at</dt>
          <dd>{execution.settledAtBlock !== null ? `block ${execution.settledAtBlock.toLocaleString()}` : "not settled"}</dd>
        </dl>
      </Panel>

      <Panel title="Attribution" id="execution-attribution-heading">
        {attributionState.status === "loading" && <LoadingState label="Loading attribution…" />}
        {attributionState.status === "ready" && (
          <>
            <h4>Edge attributions</h4>
            {attributionState.data.edgeAttributions.length === 0 ? (
              <EmptyState label="No finalized parent edges received attribution for this execution." />
            ) : (
              <table className="attribution-table">
                <thead>
                  <tr>
                    <th scope="col">Edge</th>
                    <th scope="col">Child → Parent</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Effective confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {attributionState.data.edgeAttributions.map((a) => (
                    <tr key={a.edgeId}>
                      <td>
                        <Hex value={a.edgeId} />
                      </td>
                      <td>
                        <Hex value={a.childModelId} chars={4} /> → <Hex value={a.parentModelId} chars={4} />
                      </td>
                      <td>{a.amount.toString()} wei</td>
                      <td>
                        <ConfidenceBadge axis="Effective" level={a.effectiveConfidence as ConfidenceLevel} compact />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <h4>Owner credits</h4>
            {attributionState.data.ownerCredits.length === 0 ? (
              <EmptyState label="No owners were credited for this execution." />
            ) : (
              <table className="attribution-table">
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">Owner</th>
                    <th scope="col">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {attributionState.data.ownerCredits.map((c) => (
                    <tr key={`${c.executionId}-${c.modelId}`}>
                      <td>
                        <Link to={`/models/${c.modelId}`}>
                          <Hex value={c.modelId} />
                        </Link>
                      </td>
                      <td>
                        <Hex value={c.owner} />
                      </td>
                      <td>{c.amount.toString()} wei</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
