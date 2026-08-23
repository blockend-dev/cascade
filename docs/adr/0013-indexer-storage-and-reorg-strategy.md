# ADR 0013 — Indexer storage engine and reorg-safety strategy

## Status
Accepted

## Context

Phase 9 needs a real embedded database — the phase brief is explicit that
projection uniqueness (canonical event identity, model ID, edge ID,
execution ID, provenance-per-model) should be backstopped by database
constraints, not application code alone. No package in this repository
has established a database convention yet (`relayer/` and `wrapper/` are
both deliberately in-memory, restart-unsafe-by-design — see their own
READMEs); Phase 9 is the first phase that actually needs durable,
queryable, constraint-enforced storage.

Phase 9 also needs an answer to reorg safety, which none of the prior
phases had to consider — the relayer's local state is explicitly
non-authoritative and a restart just re-derives everything from live
chain reads (`contracts/test/relayer/relayer.test.ts`'s "survives
restart" test proves this). An indexer's whole job is to retain
historical state across restarts, which means it can retain state
derived from a block that stops being canonical — a new failure mode
this repository has not had to design against before.

## Decision — storage engine: `node:sqlite`

Node's built-in `node:sqlite` module (stable-enough, flagged
experimental, ships in the Node runtime with no native compilation step)
is used instead of a native-binding SQLite driver (e.g.
`better-sqlite3`) or a separate server process (Postgres, etc.).

Reasoning, in order of weight:

1. **This environment has a documented, real native-module build
   problem.** Phase 7's README/ADR history already records that this
   Windows/npm toolchain cannot build native addons (`node-gyp` needs a
   working Python that isn't present) — `@0gfoundation/0g-storage-ts-sdk`
   had to be installed with `--ignore-scripts` to work around exactly
   this. `better-sqlite3` requires a native build step and would hit the
   identical wall. `node:sqlite` requires no native build step because
   it's compiled into the Node binary itself — verified working in this
   exact environment (`node -e "require('node:sqlite')..."` succeeds
   with a real `CREATE TABLE ... UNIQUE`/`INSERT`/`SELECT` round trip)
   before this decision was made, not assumed.
2. **A real relational engine, not a second bespoke in-memory store.**
   The brief explicitly wants database constraints (`UNIQUE`, indexes)
   backstopping idempotency — a hand-rolled `Map`-based store (the
   pattern `relayer/`'s `executionStore.ts` uses) would mean
   re-implementing uniqueness/constraint enforcement in application code,
   which is exactly the kind of protocol-adjacent logic this project's
   discipline says to avoid duplicating by hand when a real primitive
   already exists.
3. **No new npm dependency, no new toolchain surface.** `node:sqlite` is
   part of Node itself (this environment runs Node 24.11.1, well past
   `node:sqlite`'s stabilization). This keeps `indexer/package.json`'s
   dependency footprint at parity with `relayer/`/`wrapper/`/`sdk/`
   (only `ethers` plus dev tooling) rather than introducing an ORM or a
   second database technology's operational footprint.

Consequence of "experimental": `node:sqlite`'s API may still change in
future Node versions. This is an accepted, disclosed trade-off — the
module is used only through a single thin `db.ts` wrapper, so a future
migration to a different driver (if `node:sqlite` is ever removed)
touches one file, not the whole package.

Numeric encoding: all `uint256`/`uint64` chain values (wei amounts,
epochs) are stored as decimal-string `TEXT`, converted via
`BigInt(...).toString()` at the boundary — never as SQLite `INTEGER`,
which is a signed 64-bit type that would silently lose precision above
`Number.MAX_SAFE_INTEGER` for large wei amounts. Hashes and addresses are
stored as lowercase hex `TEXT`. Only genuinely small, bounded integers
(`block_number`, `log_index`, `transaction_index`, basis points,
enum-backed status values) are stored as SQLite `INTEGER`.

## Decision — reorg-safety strategy: confirmation depth + tip-hash checkpoint + full-replay rollback

Three mechanisms exist in the reorg-handling design space this phase's
brief lists: confirmation depth, canonical block-hash checkpoints, and
rollback of projections after divergence is detected. All three are used
together, deliberately, rather than picking just one — but the
implementation of each is kept as small as it can be:

1. **Confirmation depth** (`config.confirmations`, default 5) is the
   first line of defense: a sync tick never ingests logs from blocks
   newer than `head - confirmations`. This alone eliminates the vast
   majority of real reorgs by construction — most reorgs are 1-2 blocks
   deep, and simply not looking at unconfirmed blocks yet is cheaper and
   more robust than detecting and undoing them after the fact.
2. **Tip-hash checkpoint** (a single-row `sync_state` table storing the
   `(block_number, block_hash)` of the last block the indexer actually
   ingested) is the cheap, O(1)-per-tick defense for the rare case a
   reorg reaches deeper than the confirmation cushion: at the start of
   every tick, the indexer re-fetches the live hash at its own
   `last_block_number` and compares it to what it stored. A mismatch
   means the chain the indexer thought was canonical no longer is.
3. **Rollback via full projection replay**, only triggered by a detected
   mismatch: the indexer walks backward through the **distinct
   `(block_number, block_hash)` pairs already recorded on its own stored
   `events` rows** (not a separately maintained per-block checkpoint
   table — the event rows already carry this provenance, so a second
   table would just be a redundant, driftable copy of the same
   information), re-fetching each block's live hash from the RPC until
   it finds one that still matches. Every event row at or after that
   divergence point is deleted, and **all projection tables are dropped
   and rebuilt by replaying every remaining event in canonical order**
   — the exact same code path `resync --from-genesis` already uses and
   already has to be correct, rather than a second, separate
   "undo-projection-effects-in-reverse" implementation that would need
   its own, independently-audited correctness proof for every event
   type. If no stored event's block hash matches (a reorg deeper than
   all locally retained history — extreme, and logged as a distinct,
   loud condition), the indexer falls back to wiping all state and
   resyncing from `config.startBlock`.

This is a deliberate trade-off, not an oversight: a reorg is handled by
a full projection rebuild rather than a targeted incremental undo, which
costs `O(total historical events)` instead of `O(rolled-back events)`.
For an indexer whose stated job is correctness and auditability, not raw
throughput at large scale (see the phase brief's own "do not prematurely
optimize"), this is the right trade to make — it means there is exactly
one piece of code that turns "a list of canonical events" into
"projection state," used identically for the initial backfill, ordinary
incremental sync, `resync --from-genesis`, and reorg recovery. Four code
paths sharing one correctness property is safer than four related but
distinct ones.

The invariant this whole design exists to uphold: **a projection must
never permanently retain state derived from a block that is no longer
canonical.** Both the confirmation-depth cushion and the rollback path
serve that one invariant from two different angles (avoid the problem;
detect and fully correct it when avoidance wasn't enough).

## Consequences

- `indexer/` gains exactly one new runtime dependency surface:
  `node:sqlite`, which is not an npm package and cannot drift in
  `package-lock.json`.
- Reorg recovery is `O(events since genesis)`, not `O(events rolled
  back)` — acceptable for this phase's scope; revisit if the indexer is
  ever asked to track a chain with a genuinely large historical event
  volume in production.
- Because rollback and backfill share one replay code path, a bug fixed
  in projection logic is fixed for both, and a rebuild-from-genesis test
  is simultaneously a reorg-rollback-correctness test in the specific
  case where the "divergence point" is genesis itself.
