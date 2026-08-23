# indexer

Phase 9. Read-only event indexer — projects Cascade's on-chain event
stream into a queryable, reconstructible SQLite database. **Not a
protocol authority**: the chain is always correct; this is a cache. See
[`docs/indexer.md`](../docs/indexer.md) for the full event inventory,
projection model, and reorg strategy, and
[`docs/adr/0013-indexer-storage-and-reorg-strategy.md`](../docs/adr/0013-indexer-storage-and-reorg-strategy.md)
for the storage-engine and reorg-safety decisions.

## Run

```
npm install
cp .env.example .env   # fill in RPC_URL, chain id, contract addresses
npm run dev
```

Starts a continuous sync loop against `RPC_URL` plus a read-only HTTP
JSON query server on `HTTP_PORT` (default 8788) — see ADR 0014 for why
the HTTP layer exists (Phase 10's frontend runs in a browser, which
cannot import `node:sqlite` directly) and
[`docs/indexer.md`](../docs/indexer.md) §10 for the full route list.

To use `createIndexer(db, provider, config)` directly instead (e.g.
from another Node process, or in a test):

```typescript
import { ethers } from "ethers";
import { openDb, createIndexer, query, defaultConfig } from "@cascade/indexer";

const db = openDb("./cascade-index.sqlite");
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const indexer = createIndexer(db, provider, defaultConfig({
  addresses: { cascadeRegistry, executionRegistry, attributionSettlement, trainingProvenanceRegistry },
  startBlock: 12345, // the contracts' deployment block
}));

await indexer.syncToHead();
const model = query.getModel(db, modelId);
```

## Structure

| Module | Responsibility |
|---|---|
| `ingestion.ts` | Reads raw blockchain logs — no decoding, no projection. |
| `normalize.ts` | Decodes raw logs into canonical Cascade events, using the SDK's generated ABIs (ADR 0012) — no hand-maintained third ABI copy. |
| `projection.ts` | Applies canonical events to indexed SQLite state — every function is a pure, idempotent upsert. |
| `reorg.ts` | Reorg detection (tip-hash checkpoint) and recovery (rollback + full replay) — see ADR 0013. |
| `sync.ts` | Orchestrates ingestion → normalization → projection with confirmation-depth and reorg checks; the `createIndexer()` entrypoint. |
| `query.ts` | Read-only query API — the only way callers should read indexed state. |
| `db.ts` | The one file that touches `node:sqlite` directly; schema definitions. |
| `config.ts` / `types.ts` / `serialize.ts` | Configuration, canonical event/row types, and the bigint-safe JSON helpers the `events` table's payload column relies on. |

Tests live in `contracts/test/indexer/` — real deployed contracts on
Hardhat's local network, real chain reorgs via `evm_snapshot`/
`evm_revert` (not simulated), not mocks.
