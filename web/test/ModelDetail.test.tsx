import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ModelDetail } from "../src/pages/ModelDetail";
import { WalletContext } from "../src/wallet/WalletContext";
import { IndexerContext } from "../src/api/IndexerContext";
import { RouterProvider } from "../src/router";
import { fakeWalletState } from "./fixtures";
import { IndexerClient } from "../src/api/indexerClient";
import { ModelRow } from "../../indexer/src/types";
import { fakeConfig } from "./fixtures";

const MODEL_ID = "0x" + "11".repeat(32);

function baseModel(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    modelId: MODEL_ID,
    owner: "0xowner",
    modelCommitment: "0x" + "22".repeat(32),
    metadataURI: "0g-storage://manifest",
    status: "Active",
    createdAtBlock: 10,
    createdAtTimestamp: 1000,
    ...overrides,
  };
}

function fakeIndexer(overrides: Partial<IndexerClient> = {}): IndexerClient {
  return {
    getModel: vi.fn().mockResolvedValue(baseModel()),
    getModelLineage: vi.fn().mockResolvedValue({ parents: [], children: [] }),
    getTrainingProvenance: vi.fn().mockResolvedValue(null),
    listExecutionsByModel: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getSyncStatus: vi.fn().mockResolvedValue({ chainId: 31337n, lastIndexedBlock: 10, lastIndexedBlockHash: "0x0", headBlock: 10, safeHead: 10, lagBlocks: 0 }),
    ...overrides,
  } as unknown as IndexerClient;
}

function fakeClient() {
  return {
    read: { getModel: vi.fn().mockResolvedValue(baseModel()) },
    wrapperInfo: { getRequiredModelCommitment: vi.fn().mockResolvedValue("0x" + "22".repeat(32)) },
  };
}

function renderModel(indexer: IndexerClient, client = fakeClient()) {
  return render(
    <RouterProvider>
      <IndexerContext.Provider value={indexer}>
        <WalletContext.Provider value={fakeWalletState({ client: client as never })}>
          <ModelDetail modelId={MODEL_ID} config={fakeConfig()} />
        </WalletContext.Provider>
      </IndexerContext.Provider>
    </RouterProvider>
  );
}

describe("ModelDetail — never fabricates data, distinguishes indexed vs. live", () => {
  it("renders identity fields from real indexed data", async () => {
    renderModel(fakeIndexer());
    expect(await screen.findByText("Active")).toBeInTheDocument();
  });

  it("shows a not-found state for an unknown/unindexed model rather than rendering blank or crashing", async () => {
    renderModel(fakeIndexer({ getModel: vi.fn().mockResolvedValue(null) }));
    expect(await screen.findByText(new RegExp(`No model indexed with ID ${MODEL_ID}`))).toBeInTheDocument();
  });

  it("shows an explicit empty state for training provenance rather than inventing a Level 2 record", async () => {
    renderModel(fakeIndexer());
    expect(await screen.findByText(/No Level 2 training provenance registered/)).toBeInTheDocument();
  });

  it("shows an explicit empty state for lineage rather than fabricating an ancestor", async () => {
    renderModel(fakeIndexer());
    expect(await screen.findByText(/no registered ancestry/)).toBeInTheDocument();
  });

  it("flags a mismatch between indexed and live commitment rather than silently trusting the indexed value", async () => {
    const client = fakeClient();
    client.read.getModel = vi.fn().mockResolvedValue(baseModel({ modelCommitment: "0x" + "99".repeat(32) }));
    renderModel(fakeIndexer(), client);
    expect(await screen.findByText(/MISMATCH/)).toBeInTheDocument();
  });

  it("shows a match confirmation when indexed and live commitment agree", async () => {
    renderModel(fakeIndexer());
    expect(await screen.findByText(/— match/)).toBeInTheDocument();
  });
});
