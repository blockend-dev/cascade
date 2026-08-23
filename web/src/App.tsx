import React from "react";
import { AppConfig } from "./config";
import { WalletProvider } from "./wallet/WalletContext";
import { IndexerProvider } from "./api/IndexerContext";
import { RouterProvider, Routes, RouteDef } from "./router";
import { Header } from "./components/Header";
import { EmptyState } from "./components/primitives";
import { ModelExplorer } from "./pages/ModelExplorer";
import { ModelDetail } from "./pages/ModelDetail";
import { Execution } from "./pages/Execution";
import { OwnerDashboard } from "./pages/OwnerDashboard";
import { Provider as ProviderPage } from "./pages/Provider";
import { About } from "./pages/About";

export function App({ config }: { config: AppConfig }) {
  const routes: RouteDef[] = [
    { pattern: "/", render: () => <ModelExplorer /> },
    { pattern: "/models/:modelId", render: (p) => <ModelDetail modelId={p.modelId} config={config} /> },
    { pattern: "/executions/:executionId", render: (p) => <Execution executionId={p.executionId} /> },
    { pattern: "/providers/:address", render: (p) => <ProviderPage address={p.address} /> },
    { pattern: "/dashboard", render: () => <OwnerDashboard config={config} /> },
    { pattern: "/about", render: () => <About config={config} /> },
  ];

  return (
    <RouterProvider>
      <IndexerProvider config={config}>
        <WalletProvider config={config}>
          <a href="#main-content" className="skip-link">
            Skip to main content
          </a>
          <Header config={config} />
          <main id="main-content" tabIndex={-1}>
            <Routes routes={routes} notFound={<EmptyState label="Page not found." />} />
          </main>
        </WalletProvider>
      </IndexerProvider>
    </RouterProvider>
  );
}
