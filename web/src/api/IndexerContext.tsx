import React, { createContext, useContext, useMemo } from "react";
import { IndexerClient } from "./indexerClient";
import { AppConfig } from "../config";

// Exported so tests can override with a fake IndexerClient without a
// real HTTP server — see web/test/*.test.tsx.
export const IndexerContext = createContext<IndexerClient | null>(null);

export function IndexerProvider({ config, children }: { config: AppConfig; children: React.ReactNode }) {
  const client = useMemo(() => new IndexerClient(config), [config]);
  return <IndexerContext.Provider value={client}>{children}</IndexerContext.Provider>;
}

export function useIndexer(): IndexerClient {
  const ctx = useContext(IndexerContext);
  if (!ctx) throw new Error("useIndexer() called outside <IndexerProvider>");
  return ctx;
}
