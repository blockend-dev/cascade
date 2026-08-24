import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Provider as ProviderPage } from "../src/pages/Provider";
import { IndexerContext } from "../src/api/IndexerContext";
import { RouterProvider } from "../src/router";
import { IndexerClient } from "../src/api/indexerClient";
import { ProviderMode } from "../../sdk/src/types";

const ADDRESS = "0x" + "77".repeat(20);

function fakeIndexer(mode: ProviderMode): IndexerClient {
  return {
    getProvider: vi.fn().mockResolvedValue({ provider: ADDRESS, mode, signerCount: 1 }),
    getProviderSigners: vi.fn().mockResolvedValue([{ signer: "0xsigner", provider: ADDRESS, active: true }]),
    listExecutionsByProvider: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    // DataFreshness (rendered on every page, docs/frontend.md §5) calls this on mount.
    getSyncStatus: vi.fn().mockResolvedValue({
      chainId: 31337n,
      lastIndexedBlock: 100,
      lastIndexedBlockHash: "0x" + "aa".repeat(32),
      headBlock: 100,
      safeHead: 97,
      lagBlocks: 0,
    }),
  } as unknown as IndexerClient;
}

function renderProvider(indexer: IndexerClient) {
  return render(
    <RouterProvider>
      <IndexerContext.Provider value={indexer}>
        <ProviderPage address={ADDRESS} />
      </IndexerContext.Provider>
    </RouterProvider>
  );
}

describe("Provider page — 'eligible' is distinct from 'currently attested'", () => {
  it("a Standard-mode provider is described honestly as Declared-confidence, no wrapper claim", async () => {
    renderProvider(fakeIndexer(ProviderMode.Standard));
    expect(await screen.findByText(/Declared serving confidence/)).toBeInTheDocument();
    expect(screen.queryByText(/eligible/)).not.toBeInTheDocument();
  });

  it("a CascadeWrapper-mode provider is described as eligible, explicitly distinguished from 'currently attested'", async () => {
    renderProvider(fakeIndexer(ProviderMode.CascadeWrapper));
    expect(await screen.findByText(/eligible/)).toBeInTheDocument();
    expect(await screen.findByText(/not the same as/)).toBeInTheDocument();
  });

  it("shows an empty state rather than fabricating signers when none are registered", async () => {
    const indexer = fakeIndexer(ProviderMode.Standard);
    (indexer.getProviderSigners as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    renderProvider(indexer);
    expect(await screen.findByText(/No signers currently registered/)).toBeInTheDocument();
  });
});
