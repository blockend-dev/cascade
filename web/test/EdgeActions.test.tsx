import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EdgeActions } from "../src/components/EdgeActions";
import { WalletContext } from "../src/wallet/WalletContext";
import { fakeConfig, fakeWalletState } from "./fixtures";
import { EdgeRow } from "../../indexer/src/types";

const EDGE: EdgeRow = {
  edgeId: "0x" + "aa".repeat(32),
  childModelId: "0x" + "bb".repeat(32),
  parentModelId: "0x" + "cc".repeat(32),
  confidenceLevel: 0,
  royaltyBps: 1000,
  stake: 10n ** 16n,
  status: "Pending",
  challenger: null,
  challengeBond: null,
  registeredAtBlock: 1,
};

function renderEdgeActions(edge: EdgeRow = EDGE) {
  const client = {
    read: { getCascadeRegistryParameters: vi.fn().mockResolvedValue({ challengeBondAmount: 20000000000000000n, minStake: 10000000000000000n, maxDepth: 8, maxParentBps: 5000, maxParentsPerModel: 16, challengeWindow: 259200, resolver: "0xresolver" }) },
    write: {
      challengeEdge: vi.fn().mockResolvedValue({ hash: "0x" + "11".repeat(32) }),
      finalizeEdge: vi.fn().mockResolvedValue({ hash: "0x" + "22".repeat(32) }),
    },
  };
  render(
    <WalletContext.Provider value={fakeWalletState({ account: "0xowner0000000000000000000000000000000000", client: client as never })}>
      <EdgeActions edge={edge} config={fakeConfig()} />
    </WalletContext.Provider>
  );
  return { client };
}

describe("EdgeActions — challenge bond is always the live protocol value, never client-editable", () => {
  it("shows the live challenge bond amount and no editable amount input", async () => {
    renderEdgeActions();
    expect(await screen.findByText(/20000000000000000 wei/)).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/bond/i)).not.toBeInTheDocument(); // no input, only a button showing the live value
  });

  it("challengeEdge is called with exactly the live-read bond amount, not a client-supplied number", async () => {
    const { client } = renderEdgeActions();
    const button = await screen.findByRole("button", { name: /Challenge \(bond:/ });
    fireEvent.click(button);
    await waitFor(() => expect(client.write.challengeEdge).toHaveBeenCalled());
    expect(client.write.challengeEdge).toHaveBeenCalledWith(EDGE.edgeId, 20000000000000000n);
  });

  it("renders no actions at all for a Finalized or Rejected edge", () => {
    renderEdgeActions({ ...EDGE, status: "Finalized" });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing when no wallet is connected — never prompts an anonymous write", () => {
    const client = { read: { getCascadeRegistryParameters: vi.fn() }, write: {} };
    render(
      <WalletContext.Provider value={fakeWalletState({ account: null, client: client as never })}>
        <EdgeActions edge={EDGE} config={fakeConfig()} />
      </WalletContext.Provider>
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
