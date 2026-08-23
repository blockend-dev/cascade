import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Execution } from "../src/pages/Execution";
import { IndexerContext } from "../src/api/IndexerContext";
import { RouterProvider } from "../src/router";
import { IndexerClient } from "../src/api/indexerClient";

const EXECUTION_ID = "0x" + "33".repeat(32);

function fakeIndexer(overrides: Partial<IndexerClient> = {}): IndexerClient {
  return {
    getExecution: vi.fn().mockResolvedValue({
      executionId: EXECUTION_ID,
      provider: "0xprovider",
      modelId: "0x" + "44".repeat(32),
      requestHash: "0x" + "55".repeat(32),
      epoch: 1n,
      amount: 1000000000000000n,
      servingConfidence: 0,
      consumedAtBlock: 10,
      settledAtBlock: 10,
    }),
    getExecutionAttribution: vi.fn().mockResolvedValue({ edgeAttributions: [], ownerCredits: [] }),
    ...overrides,
  } as unknown as IndexerClient;
}

function renderExecution(indexer: IndexerClient) {
  return render(
    <RouterProvider>
      <IndexerContext.Provider value={indexer}>
        <Execution executionId={EXECUTION_ID} />
      </IndexerContext.Provider>
    </RouterProvider>
  );
}

describe("Execution page — never fabricates unemitted fields", () => {
  it("explicitly labels responseHash as not emitted by the protocol event, rather than inventing a value", async () => {
    renderExecution(fakeIndexer());
    expect(await screen.findByText(/Not emitted by the protocol event/)).toBeInTheDocument();
  });

  it("shows a not-found state for an unknown execution rather than blank content", async () => {
    renderExecution(fakeIndexer({ getExecution: vi.fn().mockResolvedValue(null) }));
    expect(await screen.findByText(new RegExp(`No execution indexed with ID ${EXECUTION_ID}`))).toBeInTheDocument();
  });

  it("shows an explicit empty state when no edges received attribution, not a fabricated zero-row table claim of completeness", async () => {
    renderExecution(fakeIndexer());
    expect(await screen.findByText(/No finalized parent edges received attribution/)).toBeInTheDocument();
  });

  it("renders the real amount and serving confidence from indexed data", async () => {
    renderExecution(fakeIndexer());
    expect(await screen.findByText(/1000000000000000 wei/)).toBeInTheDocument();
    expect(await screen.findByText(/Declared/)).toBeInTheDocument();
  });
});
