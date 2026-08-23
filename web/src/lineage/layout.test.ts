import { describe, it, expect } from "vitest";
import { layoutDag } from "./layout";
import { EdgeRow, ModelRow } from "../../../indexer/src/types";

function model(id: string): ModelRow {
  return {
    modelId: id,
    owner: "0xowner",
    modelCommitment: "0xcommit",
    metadataURI: "",
    status: "Active",
    createdAtBlock: 1,
    createdAtTimestamp: 1,
  };
}

function edge(edgeId: string, child: string, parent: string, confidenceLevel = 0, status: EdgeRow["status"] = "Finalized"): EdgeRow {
  return {
    edgeId,
    childModelId: child,
    parentModelId: parent,
    confidenceLevel,
    royaltyBps: 1000,
    stake: 0n,
    status,
    challenger: null,
    challengeBond: null,
    registeredAtBlock: 1,
  };
}

describe("layoutDag — pure lineage layout (no rendering, no network)", () => {
  it("single parent: one generation above the focal model", () => {
    const models = new Map([["A", model("A")], ["B", model("B")]]);
    const layout = layoutDag("B", models, [edge("e1", "B", "A")]);
    expect(layout.nodes.find((n) => n.modelId === "A")!.generation).toBe(-1);
    expect(layout.nodes.find((n) => n.modelId === "B")!.generation).toBe(0);
    expect(layout.minGeneration).toBe(-1);
  });

  it("multi-parent DAG (diamond): D has two independent parents B and C, both deriving from A", () => {
    const models = new Map(["A", "B", "C", "D"].map((id) => [id, model(id)]));
    const edges = [edge("e1", "B", "A"), edge("e2", "C", "A"), edge("e3", "D", "B"), edge("e4", "D", "C")];
    const layout = layoutDag("D", models, edges);
    expect(layout.nodes.find((n) => n.modelId === "A")!.generation).toBe(-2);
    expect(layout.nodes.find((n) => n.modelId === "B")!.generation).toBe(-1);
    expect(layout.nodes.find((n) => n.modelId === "C")!.generation).toBe(-1);
    expect(layout.nodes.find((n) => n.modelId === "D")!.generation).toBe(0);
    expect(layout.edges).toHaveLength(4);
  });

  it("multi-hop lineage: A -> B -> C -> D, three generations above D", () => {
    const models = new Map(["A", "B", "C", "D"].map((id) => [id, model(id)]));
    const edges = [edge("e1", "B", "A"), edge("e2", "C", "B"), edge("e3", "D", "C")];
    const layout = layoutDag("D", models, edges);
    expect(layout.nodes.find((n) => n.modelId === "A")!.generation).toBe(-3);
    expect(layout.maxGeneration - layout.minGeneration).toBe(3);
  });

  it("descendants render below the focal model (positive generation)", () => {
    const models = new Map(["A", "B"].map((id) => [id, model(id)]));
    const layout = layoutDag("A", models, [edge("e1", "B", "A")]);
    expect(layout.nodes.find((n) => n.modelId === "B")!.generation).toBe(1);
  });

  it("a model with no lineage at all lays out as a single isolated node", () => {
    const models = new Map([["A", model("A")]]);
    const layout = layoutDag("A", models, []);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.edges).toHaveLength(0);
  });

  it("preserves each edge's actual confidence level and status — never upgrades or merges them", () => {
    const models = new Map(["A", "B", "C"].map((id) => [id, model(id)]));
    const edges = [edge("e1", "B", "A", 2, "Finalized"), edge("e2", "C", "B", 0, "Challenged")];
    const layout = layoutDag("C", models, edges);
    const e1 = layout.edges.find((e) => e.edge.edgeId === "e1")!;
    const e2 = layout.edges.find((e) => e.edge.edgeId === "e2")!;
    expect(e1.edge.confidenceLevel).toBe(2);
    expect(e1.edge.status).toBe("Finalized");
    expect(e2.edge.confidenceLevel).toBe(0);
    expect(e2.edge.status).toBe("Challenged");
  });

  it("an edge referencing a model outside the discovered neighborhood is excluded, not fabricated with a placeholder node", () => {
    const models = new Map([["A", model("A")]]);
    // "unrelated" never appears in generation map since it's unreachable from focal "A".
    const layout = layoutDag("A", models, [edge("far", "unrelated-child", "unrelated-parent")]);
    expect(layout.edges).toHaveLength(0);
    expect(layout.nodes).toHaveLength(1);
  });
});
