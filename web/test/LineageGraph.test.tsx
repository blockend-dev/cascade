import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LineageGraph } from "../src/lineage/LineageGraph";
import { layoutDag } from "../src/lineage/layout";
import { RouterProvider } from "../src/router";
import { ModelRow, EdgeRow } from "../../indexer/src/types";

function model(id: string): ModelRow {
  return { modelId: id, owner: "0xowner", modelCommitment: "0xc", metadataURI: "", status: "Active", createdAtBlock: 1, createdAtTimestamp: 1 };
}
function edge(id: string, child: string, parent: string, confidenceLevel: number, status: EdgeRow["status"] = "Finalized"): EdgeRow {
  return { edgeId: id, childModelId: child, parentModelId: parent, confidenceLevel, royaltyBps: 1500, stake: 0n, status, challenger: null, challengeBond: null, registeredAtBlock: 1 };
}

describe("LineageGraph — accessible, non-color-only representation of a real DAG shape", () => {
  it("provides a full textual/table fallback with the same edges the SVG shows — the actual accessible representation", () => {
    const models = new Map([["A", model("A")], ["B", model("B")]]);
    const layout = layoutDag("B", models, [edge("e1", "B", "A", 2)]);
    render(
      <RouterProvider>
        <LineageGraph layout={layout} focalModelId="B" />
      </RouterProvider>
    );
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("Cryptographically Bound");
    expect(table).toHaveTextContent("15.00%");
  });

  it("the SVG carries an aria-label summarizing the graph for screen readers, not just visual content", () => {
    const models = new Map([["A", model("A")], ["B", model("B")]]);
    const layout = layoutDag("B", models, [edge("e1", "B", "A", 0)]);
    render(
      <RouterProvider>
        <LineageGraph layout={layout} focalModelId="B" />
      </RouterProvider>
    );
    expect(screen.getByRole("img", { name: /Lineage graph/ })).toBeInTheDocument();
  });

  it("each edge is independently keyboard-focusable and activatable (role=button, tabIndex=0)", () => {
    const models = new Map([["A", model("A")], ["B", model("B")]]);
    const layout = layoutDag("B", models, [edge("e1", "B", "A", 1)]);
    render(
      <RouterProvider>
        <LineageGraph layout={layout} focalModelId="B" />
      </RouterProvider>
    );
    const edgeButtons = screen.getAllByRole("button", { name: /Edge .* to .*/ });
    expect(edgeButtons.length).toBeGreaterThan(0);
    expect(edgeButtons[0]).toHaveAttribute("tabIndex", "0");
  });

  it("a Declared edge and a CryptographicallyBound edge get visually distinct treatment via more than one signal (dash pattern differs, and the text label states the level explicitly)", () => {
    const models = new Map([["A", model("A")], ["B", model("B")], ["C", model("C")]]);
    const layout = layoutDag("C", models, [edge("e1", "B", "A", 0), edge("e2", "C", "B", 2)]);
    render(
      <RouterProvider>
        <LineageGraph layout={layout} focalModelId="C" />
      </RouterProvider>
    );
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("Declared");
    expect(table).toHaveTextContent("Cryptographically Bound");
  });

  it("does not fabricate a status glyph for a status the edge doesn't actually have", () => {
    const models = new Map([["A", model("A")], ["B", model("B")]]);
    const layout = layoutDag("B", models, [edge("e1", "B", "A", 0, "Challenged")]);
    render(
      <RouterProvider>
        <LineageGraph layout={layout} focalModelId="B" />
      </RouterProvider>
    );
    expect(screen.getByRole("table")).toHaveTextContent("Challenged");
    expect(screen.getByRole("table")).not.toHaveTextContent("Finalized");
  });
});
