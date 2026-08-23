import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Header } from "../src/components/Header";
import { WalletContext } from "../src/wallet/WalletContext";
import { RouterProvider } from "../src/router";
import { fakeConfig, fakeWalletState } from "./fixtures";

function renderHeader(walletState: ReturnType<typeof fakeWalletState>, config = fakeConfig()) {
  return render(
    <RouterProvider>
      <WalletContext.Provider value={walletState}>
        <Header config={config} />
      </WalletContext.Provider>
    </RouterProvider>
  );
}

describe("Header — wallet connection state and wrong-chain detection", () => {
  it("shows a connect button when no wallet is connected", () => {
    renderHeader(fakeWalletState());
    expect(screen.getByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
  });

  it("shows the connected account and a disconnect button once connected", () => {
    renderHeader(fakeWalletState({ account: "0xabc0000000000000000000000000000000000a" }));
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect wallet" })).not.toBeInTheDocument();
  });

  it("surfaces a wrong-chain warning as an alert when connected to the wrong network — never a silent no-op", () => {
    renderHeader(fakeWalletState({ account: "0xabc0000000000000000000000000000000000a", chainId: 1n, isWrongChain: true }));
    expect(screen.getByRole("alert")).toHaveTextContent("Wrong network");
  });

  it("does not show a wrong-chain warning on the correct network", () => {
    renderHeader(fakeWalletState({ account: "0xabc0000000000000000000000000000000000a", chainId: 31337n, isWrongChain: false }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces a connection error distinctly (e.g. no wallet extension detected)", () => {
    renderHeader(fakeWalletState({ error: "No wallet extension detected." }));
    expect(screen.getByText("No wallet extension detected.")).toBeInTheDocument();
  });

  it("disables the connect button while a connection attempt is in flight", () => {
    renderHeader(fakeWalletState({ isConnecting: true }));
    expect(screen.getByRole("button", { name: /Connecting/ })).toBeDisabled();
  });
});
