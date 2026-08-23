import React, { useState } from "react";
import { useIndexer } from "../api/IndexerContext";
import { useAsync } from "../hooks/useAsync";
import { LoadingState, EmptyState, ErrorState, Hex, Panel } from "../components/primitives";
import { DataFreshness } from "../components/DataFreshness";
import { Link } from "../router";
import { ModelRow } from "../../../indexer/src/types";

/**
 * Searchable/browsable model list. A model ID is a bytes32 keccak hash
 * (docs/protocol-spec.md §1) — there is no protocol-level free-text
 * search index, so "search" here means: paste/type an exact model ID
 * to jump to it (a real, honest capability), and otherwise browse the
 * paginated registration-order list. No fabricated fuzzy search.
 */
export function ModelExplorer() {
  const indexer = useIndexer();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorHistory, setCursorHistory] = useState<(string | undefined)[]>([]);
  const [jumpTo, setJumpTo] = useState("");

  const state = useAsync(() => indexer.listModels({ limit: 20, cursor }), [indexer, cursor]);

  return (
    <div className="page page-model-explorer">
      <Panel title="Registered models" id="model-explorer-heading">
        <DataFreshness />
        <form
          className="jump-to-model"
          onSubmit={(e) => {
            e.preventDefault();
            if (/^0x[0-9a-fA-F]{64}$/.test(jumpTo.trim())) {
              window.location.hash = `/models/${jumpTo.trim()}`;
            }
          }}
        >
          <label htmlFor="jump-to-model-input">Model ID</label>
          <input
            id="jump-to-model-input"
            type="text"
            placeholder="0x…"
            value={jumpTo}
            onChange={(e) => setJumpTo(e.target.value)}
            pattern="0x[0-9a-fA-F]{64}"
          />
          <button type="submit">Open</button>
        </form>

        {state.status === "loading" && <LoadingState label="Loading models…" />}
        {state.status === "error" && <ErrorState label="Could not load models from the indexer." detail={String(state.error)} />}
        {state.status === "ready" && state.data.items.length === 0 && cursorHistory.length === 0 && (
          <EmptyState label="No models registered yet." />
        )}
        {state.status === "ready" && state.data.items.length > 0 && (
          <>
            <table className="model-list">
              <thead>
                <tr>
                  <th scope="col">Model ID</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Commitment</th>
                  <th scope="col">Status</th>
                  <th scope="col">Registered</th>
                </tr>
              </thead>
              <tbody>
                {state.data.items.map((m: ModelRow) => (
                  <tr key={m.modelId}>
                    <td>
                      <Link to={`/models/${m.modelId}`}>
                        <Hex value={m.modelId} />
                      </Link>
                    </td>
                    <td>
                      <Hex value={m.owner} />
                    </td>
                    <td>
                      <Hex value={m.modelCommitment} />
                    </td>
                    <td>
                      <span className={`status-pill status-${m.status.toLowerCase()}`}>{m.status}</span>
                    </td>
                    <td>block {m.createdAtBlock.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="pagination">
              <button
                type="button"
                disabled={cursorHistory.length === 0}
                onClick={() => {
                  const prev = [...cursorHistory];
                  const last = prev.pop();
                  setCursorHistory(prev);
                  setCursor(last);
                }}
              >
                ← Previous
              </button>
              <button
                type="button"
                disabled={!state.data.nextCursor}
                onClick={() => {
                  setCursorHistory([...cursorHistory, cursor]);
                  setCursor(state.data.nextCursor ?? undefined);
                }}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
