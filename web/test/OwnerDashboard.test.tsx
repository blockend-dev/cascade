import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { OwnerDashboard } from "../src/pages/OwnerDashboard";
import { WalletContext } from "../src/wallet/WalletContext";
import { IndexerContext } from "../src/api/IndexerContext";
import { RouterProvider } from "../src/router";
import { fakeConfig, fakeWalletState } from "./fixtures";
import { IndexerClient } from "../src/api/indexerClient";

const OWNER = "0xaaaa000000000000000000000000000000000a";

function renderDashboard(claimable: bigint) {
  const client = {
    read: { getClaimable: vi.fn().mockResolvedValue(claimable) },
    write: {
      claimAttribution: vi.fn().mockResolvedValue({ hash: "0x" + "ab".repeat(32) }),
      registerModel: vi.fn().mockResolvedValue({ modelId: "0x" + "cd".repeat(32), receipt: { hash: "0x" + "ef".repeat(32) } }),
    },
    decodeError: vi.fn(),
  };
  const indexer = {
    listModelsByOwner: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    getModelLineage: vi.fn().mockResolvedValue({ parents: [], children: [] }),
    getClaims: vi.fn().mockResolvedValue([]),
    getSyncStatus: vi.fn().mockResolvedValue({ chainId: 31337n, lastIndexedBlock: 10, lastIndexedBlockHash: "0x0", headBlock: 10, safeHead: 10, lagBlocks: 0 }),
  } as unknown as IndexerClient;

  render(
    <RouterProvider>
      <IndexerContext.Provider value={indexer}>
        <WalletContext.Provider value={fakeWalletState({ account: OWNER, client: client as never })}>
          <OwnerDashboard config={fakeConfig()} />
        </WalletContext.Provider>
      </IndexerContext.Provider>
    </RouterProvider>
  );
  return { client };
}

describe("OwnerDashboard — security: no client-controlled recipient/amount for a protocol-derived value", () => {
  it("prompts to connect when no wallet is connected, rather than rendering dashboard content for nobody", () => {
    render(
      <RouterProvider>
        <IndexerContext.Provider value={{} as IndexerClient}>
          <WalletContext.Provider value={fakeWalletState({ account: null })}>
            <OwnerDashboard config={fakeConfig()} />
          </WalletContext.Provider>
        </IndexerContext.Provider>
      </RouterProvider>
    );
    expect(screen.getByText(/Connect a wallet/)).toBeInTheDocument();
  });

  it("the claim action takes no recipient or amount input — claimAttribution() is called with zero arguments", async () => {
    const { client } = renderDashboard(5000n);
    const claimButton = await screen.findByRole("button", { name: "Claim" });

    // No input field anywhere in the dashboard is labeled recipient or amount.
    expect(screen.queryByLabelText(/recipient/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^amount$/i)).not.toBeInTheDocument();

    fireEvent.click(claimButton);
    await waitFor(() => expect(client.write.claimAttribution).toHaveBeenCalled());
    expect(client.write.claimAttribution).toHaveBeenCalledWith();
  });

  it("shows the live claimable balance, not a client-editable field", async () => {
    renderDashboard(12345n);
    // "12345 wei" legitimately appears twice once claimable > 0 (the
    // balance line and the claim summary sentence) — scope to the
    // balance line specifically, the same amount the claim summary
    // sentence attributes to.
    expect(
      await screen.findByText((_, element) => element?.className === "claimable-amount" && /12345 wei/.test(element.textContent ?? ""))
    ).toBeInTheDocument();
    // The claimable amount is rendered as text, never as an <input>.
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("hides the claim button entirely when there is nothing claimable, rather than allowing a zero-value claim attempt", async () => {
    renderDashboard(0n);
    await screen.findByText(/0 wei/);
    expect(screen.queryByRole("button", { name: "Claim" })).not.toBeInTheDocument();
  });

  it("registerModel is invoked with exactly the two fields the form collects — no hidden/injected extra arguments", async () => {
    const { client } = renderDashboard(0n);
    const commitmentInput = await screen.findByLabelText(/weight commitment/i);
    const metadataInput = screen.getByLabelText(/metadata uri/i);
    fireEvent.change(commitmentInput, { target: { value: "0x" + "11".repeat(32) } });
    fireEvent.change(metadataInput, { target: { value: "0g-storage://manifest" } });
    fireEvent.click(screen.getByRole("button", { name: "Register model" }));
    await waitFor(() => expect(client.write.registerModel).toHaveBeenCalled());
    expect(client.write.registerModel.mock.calls[0]).toHaveLength(2);
  });
});
