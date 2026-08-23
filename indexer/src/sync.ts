import { DatabaseSync } from "node:sqlite";
import { ethers } from "ethers";
import { IndexerConfig } from "./config";
import { clearProjections } from "./db";
import { fetchRawLogs } from "./ingestion";
import { buildContractCatalog, ContractCatalogEntry, normalize } from "./normalize";
import { ingestEvent } from "./projection";
import { rebuildProjections, readSyncState, recoverFromReorg, tipHasReorged, writeSyncState } from "./reorg";
import { SyncStatus } from "./types";

/**
 * Orchestrates ingestion → normalization → projection, plus the
 * reorg-safety checks around it (docs/indexer.md §6). This module owns
 * *when* to sync; ingestion.ts/normalize.ts/projection.ts each own one
 * stage of *how*.
 */
export interface CascadeIndexer {
  db: DatabaseSync;
  config: IndexerConfig;
  provider: ethers.Provider;
  catalog: Map<string, ContractCatalogEntry>;
  /** Runs sync ticks until caught up to the current safe head (or
   *  `maxTicks` chunks have run, to bound a single call in a live
   *  polling loop). Returns the number of events ingested. */
  syncToHead(maxTicks?: number): Promise<{ eventsIngested: number; reorgsRecovered: number }>;
  getSyncStatus(): Promise<SyncStatus>;
  /** Wipes all state and re-ingests from `config.startBlock` —
   *  docs/indexer.md §8. */
  resyncFromGenesis(): Promise<{ eventsIngested: number }>;
}

export function createIndexer(db: DatabaseSync, provider: ethers.Provider, config: IndexerConfig): CascadeIndexer {
  const catalog = buildContractCatalog(config.addresses);

  async function runOneTick(): Promise<{ eventsIngested: number; reorged: boolean; caughtUp: boolean }> {
    const state = readSyncState(db, config.chainId);
    let reorged = false;

    if (state) {
      reorged = await tipHasReorged(provider, state);
      if (reorged) {
        await recoverFromReorg(db, provider, config.chainId);
      }
    }

    const currentState = readSyncState(db, config.chainId);
    const fromBlock = currentState ? currentState.lastBlockNumber + 1 : config.startBlock;

    const head = await provider.getBlockNumber();
    const safeHead = Math.max(head - config.confirmations, -1);
    if (safeHead < fromBlock) {
      return { eventsIngested: 0, reorged, caughtUp: true };
    }

    const toBlock = Math.min(safeHead, fromBlock + config.chunkBlocks - 1);
    const batch = await fetchRawLogs(provider, catalogAddresses(config), fromBlock, toBlock);
    const events = normalize(batch, config.chainId, catalog);

    for (const event of events) {
      ingestEvent(db, event);
    }

    const tipBlock = await provider.getBlock(toBlock);
    if (tipBlock) {
      writeSyncState(db, config.chainId, toBlock, tipBlock.hash!);
    }

    return { eventsIngested: events.length, reorged, caughtUp: toBlock >= safeHead };
  }

  return {
    db,
    config,
    provider,
    catalog,

    async syncToHead(maxTicks = 10_000) {
      let eventsIngested = 0;
      let reorgsRecovered = 0;
      for (let i = 0; i < maxTicks; i++) {
        const result = await runOneTick();
        eventsIngested += result.eventsIngested;
        if (result.reorged) reorgsRecovered++;
        if (result.caughtUp) break;
      }
      return { eventsIngested, reorgsRecovered };
    },

    async getSyncStatus() {
      const state = readSyncState(db, config.chainId);
      const head = await provider.getBlockNumber();
      const safeHead = Math.max(head - config.confirmations, -1);
      const lastIndexedBlock = state?.lastBlockNumber ?? null;
      return {
        chainId: config.chainId,
        lastIndexedBlock,
        lastIndexedBlockHash: state?.lastBlockHash ?? null,
        headBlock: head,
        safeHead,
        lagBlocks: lastIndexedBlock === null ? safeHead - config.startBlock + 1 : Math.max(safeHead - lastIndexedBlock, 0),
      };
    },

    async resyncFromGenesis() {
      db.exec(`DELETE FROM events WHERE chain_id = '${config.chainId.toString()}';`);
      clearProjections(db);
      db.prepare(`DELETE FROM sync_state WHERE chain_id = ?`).run(config.chainId.toString());
      const result = await this.syncToHead();
      return { eventsIngested: result.eventsIngested };
    },
  };
}

function catalogAddresses(config: IndexerConfig): string[] {
  return [
    config.addresses.cascadeRegistry,
    config.addresses.executionRegistry,
    config.addresses.attributionSettlement,
    config.addresses.trainingProvenanceRegistry,
  ];
}

export { rebuildProjections };
