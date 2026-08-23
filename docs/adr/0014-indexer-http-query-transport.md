# ADR 0014 — Indexer gains a thin HTTP query transport

## Status
Accepted

## Context

Phase 10's frontend runs in a browser. Phase 9's indexer (`indexer/`)
is a Node.js library built directly against `node:sqlite` — a
server-side-only API with no browser equivalent. `docs/indexer.md`'s
own query layer (`indexer/src/query.ts`) is real, correct, and exactly
what the frontend brief's data-flow diagram calls for ("Blockchain →
Indexer → query/history → Frontend"), but as shipped in Phase 9 there
is no way for code running in a browser tab to reach it — Phase 9 was
never asked to expose one, and didn't need to for its own test suite
(which calls `query.ts` functions in-process, from Node, against a real
Hardhat chain).

This is the one point in Phase 10's reconnaissance where "an important
UI requirement cannot be supported by the existing SDK/indexer data"
(the phase brief's stop condition) — except the gap isn't in the
*data* (every field the frontend needs is already projected correctly
by Phase 9) or the *query logic* (`query.ts` already has almost every
read the frontend needs). The gap is purely the *transport* between a
Node-only database and a browser tab. Resolving it doesn't touch
protocol semantics, doesn't add speculative new indexed fields, and
doesn't require changing anything Phase 9 already built — so per the
project's own working-style rule ("if not material, choose the
smallest defensible implementation and document the decision"), this
ADR resolves it rather than stopping the phase.

## Decision

`indexer/src/server.ts` — a bare `node:http` JSON server, following
the exact precedent `relayer/src/ingestion.ts` and
`wrapper/src/server.ts` already established for "one small HTTP
surface over existing core logic, no framework dependency." Every
route is a direct, unmodified call into `query.ts`; the server adds
zero new query logic; the JSON body shape mirrors `query.ts`'s return
types exactly, with `bigint` fields serialized as decimal strings (the
same convention `indexer/src/serialize.ts` already uses for SQLite
storage, reused here at the HTTP boundary for the same reason).

Routes (all `GET`, all read-only — there is no write route; writes stay
exclusively on the SDK's direct-to-contract path, per the frontend
brief's own architecture diagram):

```
GET /models?limit=&cursor=
GET /models/:modelId
GET /models/:modelId/lineage
GET /models/owner/:address?limit=&cursor=
GET /edges/:edgeId
GET /providers/:address
GET /providers/:address/signers
GET /providers/:address/executions?limit=&cursor=
GET /provenance/:modelId
GET /executions/:executionId
GET /executions/:executionId/attribution
GET /executions/model/:modelId?limit=&cursor=
GET /claimable/:address
GET /claims/:address
GET /events?contract=&eventName=&fromBlock=&toBlock=&limit=&cursor=
GET /sync-status
```

New, additive `query.ts` functions backing the two owner/provider
listing routes (`listModelsByOwner`, `listExecutionsByModel`,
`listExecutionsByProvider`) read columns (`models.owner`,
`executions.model_id`, `executions.provider`) that were already
projected in Phase 9 — this is new *query* surface, not new *data*.
Two new indexes (`idx_models_owner`, `idx_executions_provider`) back
them; both are `CREATE INDEX IF NOT EXISTS`, additive and backward
compatible with every existing Phase 9 database and test.

## What this does not do

- Does not change `projection.ts`, `normalize.ts`, `ingestion.ts`,
  `reorg.ts`, or any existing table's schema.
- Does not become a second protocol authority: every response carries
  the same "chain always wins, this is a cache" status the in-process
  query layer already implied — the server also exposes `/sync-status`
  precisely so a caller can see how stale a response might be, and the
  frontend is required (by its own brief) to surface that, not hide it.
- Does not accept writes. A malicious or buggy frontend cannot use this
  server to authorize a transaction — there is no code path from an
  HTTP request on this server to a signed transaction anywhere in the
  repository.
- Does not replace direct contract reads for anything security-
  sensitive — `sdk/`'s direct-read path remains fully independent and
  is what the frontend uses to cross-check indexed data before a write
  (docs/frontend.md's "indexed vs. live" section).

## Consequences

- `indexer/` goes from "a library" to "a library plus one optional
  process that serves it over HTTP." Nothing about running the
  library in-process (as Phase 9's own tests do, and as any other
  future Node consumer could continue to do) changes.
- The frontend depends on the indexer's HTTP surface, not its internals
  — consistent with the SDK's own boundary (`sdk/` never depends on
  `indexer/`, and this ADR does not change that either).
