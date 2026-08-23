import React, { useEffect, useState } from "react";
import { SyncStatus } from "../../../indexer/src/types";
import { useIndexer } from "../api/IndexerContext";

const STALE_THRESHOLD_BLOCKS = 10;

/**
 * "Indexed through block N" — surfaced on every page that renders
 * indexer data, per docs/frontend.md §5. Distinguishes INDEXED DATA
 * from LIVE CHAIN STATE explicitly rather than letting a user assume
 * they're the same thing.
 */
export function DataFreshness() {
  const indexer = useIndexer();
  const [status, setStatus] = useState<SyncStatus | "unavailable" | null>(null);

  useEffect(() => {
    let cancelled = false;
    indexer
      .getSyncStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus("unavailable"));
    return () => {
      cancelled = true;
    };
  }, [indexer]);

  if (status === null) return null;
  if (status === "unavailable") {
    return (
      <div className="data-freshness data-freshness-unavailable" role="status">
        Indexer unavailable — data below could not be loaded from the indexer.
      </div>
    );
  }

  const stale = status.lagBlocks > STALE_THRESHOLD_BLOCKS;
  return (
    <div className={`data-freshness ${stale ? "data-freshness-stale" : ""}`} role="status">
      {status.lastIndexedBlock === null
        ? "Indexer has not synced any blocks yet."
        : `Indexed through block ${status.lastIndexedBlock.toLocaleString()}`}
      {stale && ` — indexer is ${status.lagBlocks.toLocaleString()} blocks behind. Data below may be stale.`}
    </div>
  );
}
