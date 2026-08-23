import React, { useMemo, useState } from "react";
import { GraphLayout } from "./layout";
import { ConfidenceLevel, confidenceLabel } from "../confidence";
import { Hex } from "../components/primitives";
import { Link } from "../router";

const NODE_WIDTH = 160;
const NODE_HEIGHT = 56;
const COL_GAP = 40;
const ROW_GAP = 90;

const EDGE_DASH: Record<ConfidenceLevel, string> = {
  [ConfidenceLevel.Declared]: "4 4", // dotted — weakest
  [ConfidenceLevel.AttestedTraining]: "10 4", // dashed — attested
  [ConfidenceLevel.CryptographicallyBound]: "", // solid — cryptographically checked
};
const EDGE_WIDTH: Record<ConfidenceLevel, number> = {
  [ConfidenceLevel.Declared]: 1.5,
  [ConfidenceLevel.AttestedTraining]: 2,
  [ConfidenceLevel.CryptographicallyBound]: 3,
};
const STATUS_GLYPH: Record<string, string> = {
  Pending: "○",
  Challenged: "⚠",
  Finalized: "●",
  Rejected: "✕",
};

/**
 * Renders `layoutDag`'s output as SVG (visual) plus a permanent
 * `<table>` (the actual accessible representation — docs/frontend.md
 * §4). Confidence is never shown via color alone: stroke pattern +
 * width + a text label carry the same information the color accent
 * does, and the table repeats it as plain text.
 */
export function LineageGraph({ layout, focalModelId }: { layout: GraphLayout; focalModelId: string }) {
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const positions = useMemo(() => {
    const byGen = new Map<number, typeof layout.nodes>();
    for (const n of layout.nodes) {
      (byGen.get(n.generation) ?? byGen.set(n.generation, []).get(n.generation)!).push(n);
    }
    const pos = new Map<string, { x: number; y: number }>();
    for (const [gen, nodes] of byGen) {
      const rowWidth = nodes.length * (NODE_WIDTH + COL_GAP) - COL_GAP;
      nodes.forEach((n, i) => {
        pos.set(n.modelId, {
          x: i * (NODE_WIDTH + COL_GAP) - rowWidth / 2,
          y: (gen - layout.minGeneration) * (NODE_HEIGHT + ROW_GAP),
        });
      });
    }
    return pos;
  }, [layout]);

  const width = Math.max(...layout.nodes.map((n) => (positions.get(n.modelId)?.x ?? 0) + NODE_WIDTH), NODE_WIDTH) -
    Math.min(...layout.nodes.map((n) => positions.get(n.modelId)?.x ?? 0), 0) + 80;
  const height = (layout.maxGeneration - layout.minGeneration + 1) * (NODE_HEIGHT + ROW_GAP) + 40;
  const xOffset = -Math.min(...layout.nodes.map((n) => positions.get(n.modelId)?.x ?? 0), 0) + 40;

  const selectedEdge = layout.edges.find((e) => e.edge.edgeId === selectedEdgeId) ?? null;

  return (
    <div className="lineage-graph">
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Lineage graph centered on model ${focalModelId}, ${layout.nodes.length} models and ${layout.edges.length} edges. See the table below for the full textual representation.`}
      >
        {layout.edges.map(({ edge }) => {
          const from = positions.get(edge.parentModelId);
          const to = positions.get(edge.childModelId);
          if (!from || !to) return null;
          const x1 = from.x + xOffset + NODE_WIDTH / 2;
          const y1 = from.y + NODE_HEIGHT;
          const x2 = to.x + xOffset + NODE_WIDTH / 2;
          const y2 = to.y;
          const midY = (y1 + y2) / 2;
          const isSelected = edge.edgeId === selectedEdgeId;
          return (
            <g key={edge.edgeId}>
              <path
                d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                fill="none"
                stroke={isSelected ? "var(--accent)" : "var(--edge-stroke)"}
                strokeWidth={EDGE_WIDTH[edge.confidenceLevel as ConfidenceLevel]}
                strokeDasharray={EDGE_DASH[edge.confidenceLevel as ConfidenceLevel]}
                style={{ cursor: "pointer" }}
                tabIndex={0}
                role="button"
                aria-label={`Edge ${edge.parentModelId} to ${edge.childModelId}, ${confidenceLabel(edge.confidenceLevel)}, ${edge.royaltyBps / 100}% royalty, status ${edge.status}`}
                onClick={() => setSelectedEdgeId(edge.edgeId)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelectedEdgeId(edge.edgeId)}
              />
              <text x={(x1 + x2) / 2} y={midY - 6} className="edge-label" textAnchor="middle">
                {STATUS_GLYPH[edge.status]} {(edge.royaltyBps / 100).toFixed(2)}%
              </text>
            </g>
          );
        })}
        {layout.nodes.map((n) => {
          const p = positions.get(n.modelId);
          if (!p) return null;
          const isFocal = n.modelId === focalModelId;
          return (
            <g key={n.modelId} transform={`translate(${p.x + xOffset}, ${p.y})`}>
              <rect
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={6}
                className={`graph-node ${isFocal ? "graph-node-focal" : ""} ${n.model?.status === "Revoked" ? "graph-node-revoked" : ""}`}
              />
              <text x={NODE_WIDTH / 2} y={22} textAnchor="middle" className="graph-node-label">
                <Hex value={n.modelId} chars={5} />
              </text>
              <text x={NODE_WIDTH / 2} y={40} textAnchor="middle" className="graph-node-sublabel">
                {n.model ? (n.model.status === "Revoked" ? "Revoked" : "Active") : "Not indexed"}
              </text>
            </g>
          );
        })}
      </svg>

      {selectedEdge && (
        <div className="edge-detail" role="region" aria-label="Selected edge detail">
          <h4>Edge detail</h4>
          <dl>
            <dt>Parent</dt>
            <dd>
              <Link to={`/models/${selectedEdge.edge.parentModelId}`}>
                <Hex value={selectedEdge.edge.parentModelId} />
              </Link>
            </dd>
            <dt>Child</dt>
            <dd>
              <Link to={`/models/${selectedEdge.edge.childModelId}`}>
                <Hex value={selectedEdge.edge.childModelId} />
              </Link>
            </dd>
            <dt>Royalty share</dt>
            <dd>{(selectedEdge.edge.royaltyBps / 100).toFixed(2)}%</dd>
            <dt>Lineage confidence</dt>
            <dd>{confidenceLabel(selectedEdge.edge.confidenceLevel)}</dd>
            <dt>Status</dt>
            <dd>{selectedEdge.edge.status}</dd>
            <dt>Stake at registration</dt>
            <dd>{selectedEdge.edge.stake.toString()} wei</dd>
            {selectedEdge.edge.challenger && (
              <>
                <dt>Challenger</dt>
                <dd>
                  <Hex value={selectedEdge.edge.challenger} />
                </dd>
              </>
            )}
          </dl>
        </div>
      )}

      {/* Textual/accessibility fallback — the real accessible
          representation of the graph above, not a decorative repeat. */}
      <table className="lineage-table">
        <caption>Lineage edges (textual representation of the graph above)</caption>
        <thead>
          <tr>
            <th scope="col">Parent</th>
            <th scope="col">Child</th>
            <th scope="col">Royalty</th>
            <th scope="col">Lineage confidence</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {layout.edges.map(({ edge }) => (
            <tr key={edge.edgeId}>
              <td>
                <Link to={`/models/${edge.parentModelId}`}>
                  <Hex value={edge.parentModelId} />
                </Link>
              </td>
              <td>
                <Link to={`/models/${edge.childModelId}`}>
                  <Hex value={edge.childModelId} />
                </Link>
              </td>
              <td>{(edge.royaltyBps / 100).toFixed(2)}%</td>
              <td>{confidenceLabel(edge.confidenceLevel)}</td>
              <td>
                {STATUS_GLYPH[edge.status]} {edge.status}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
