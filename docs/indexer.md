# Cascade Indexer (Phase 9)

`indexer/` turns Cascade's on-chain event stream into a queryable,
reconstructible projection. **It is not a protocol authority.** The
blockchain remains authoritative for ownership, lineage, confidence,
challenges/finalization, provider/signer registration, training
provenance, execution consumption, settlement, balances, and
claimability. Wherever the indexer's projection and a direct contract
read would disagree, the chain wins — see "Consistency model" below.

## 1. Event inventory

Every event emitted by the four deployed contracts, as actually declared
in `contracts/src/*.sol` (verified by reading the contracts directly, not
assumed from earlier design docs — see §7 for a documentation
discrepancy this inventory found and corrected).

### CascadeRegistry

| Event | Indexed args | Non-indexed args | Emitted by | State transition |
|---|---|---|---|---|
| `ModelRegistered` | `modelId`, `owner` | `modelCommitment`, `metadataURI` | `registerModel` | Model created, status Active |
| `ModelMetadataUpdated` | `modelId` | `metadataURI` | `updateMetadataURI` | Metadata URI changed |
| `ModelOwnershipTransferred` | `modelId`, `previousOwner`, `newOwner` | — | `transferModelOwnership` | Owner changed |
| `ModelRevoked` | `modelId` | — | `revokeModel` | Status → Revoked |
| `LineageEdgeRegistered` | `edgeId`, `childModelId`, `parentModelId` | `confidenceLevel`, `royaltyBps`, `stake` | `registerLineageEdge` | Edge created, status Pending |
| `LineageEdgeChallenged` | `edgeId`, `challenger` | `bond` | `challengeEdge` | status Pending → Challenged |
| `LineageEdgeResolved` | `edgeId` | `challengeUpheld` (bool) | `resolveChallenge` | status Challenged → Rejected (`true`) or → Finalized (`false`) |
| `LineageEdgeFinalized` | `edgeId` | — | `finalizeEdge`, and `resolveChallenge` when `challengeUpheld == false` | status → Finalized (idempotent signal — see below) |
| `ResolverUpdated` | `resolver` | — | `setResolver` | admin |
| `ParameterUpdated` | — | `name` (string), `value` (uint256) | 6 admin setters | admin — **not projected**, see §4 |

`LineageEdgeFinalized` is emitted from two call paths for the same
state transition (a direct `finalizeEdge` after the challenge window
elapses unchallenged, and the "challenge failed" branch of
`resolveChallenge`). The projection treats it as an idempotent
"finalized" signal (`UPDATE edges SET status = 'Finalized' WHERE
edge_id = ?`) rather than assuming it only ever fires once per edge in
one specific way — the `LineageEdgeResolved` event is the one that
actually distinguishes "finalized via unchallenged expiry" from
"finalized via a rejected challenge," and both are stored.

**`edges.stake` is the amount staked at registration, not a live
balance.** `CascadeRegistry` zeroes its own `stake` field once an edge
is finalized or resolved (the stake has already been paid back out to
the registrant or, on a successful challenge, to the challenger — see
`CascadeRegistry.finalizeEdge`/`resolveChallenge`). The indexer
deliberately does not mirror that zeroing: `edges.stake` is populated
once, from `LineageEdgeRegistered.stake` (category A), and never
updated again — it answers "how much was staked when this edge was
registered," a fact that's permanently true, rather than "how much
does the contract currently hold for this edge," which isn't. A caller
that specifically needs the live, currently-held amount reads
`CascadeRegistry.getEdge(edgeId).stake` directly — a real, discovered
case of the indexer and a direct contract read disagreeing by design,
not a bug (docs/indexer.md §9's "chain wins" rule about staleness
does not apply here, since both values are simultaneously correct
answers to two different questions).

### ExecutionRegistry

| Event | Indexed args | Non-indexed args | Emitted by | State transition |
|---|---|---|---|---|
| `SignerRegistered` | `provider`, `signer` | — | `registerSigner` | `providerOfSigner[signer] = provider` |
| `SignerRevoked` | `provider`, `signer` | — | `revokeSigner` | `providerOfSigner[signer] = 0` |
| `ProviderModeUpdated` | `provider` | `mode` (enum) | `setProviderMode` | `providerMode[provider]` set |
| `UsageProofConsumed` | `executionId`, `provider`, `modelId` | `requestHash` | `consumeUsageProof` (called from `AttributionSettlement.settleExecution`) | `executionConsumed[executionId] = true` |
| `ParameterUpdated` | — | `name`, `value` | `setProofValidityWindow` | admin — **not projected** |

**Important gap, verified by reading the contract, not assumed:**
`UsageProofConsumed` does **not** emit `responseHash`, `chatId`,
`modelCommitment`, `epoch`, `issuedAt`, or the recovered `signer`
address — only `executionId`, `provider`, `modelId`, and `requestHash`.
The full `UsageProof` and the `VerifiedUsage.signer` field exist only in
calldata and an in-memory return value at execution time; neither is
persisted on-chain and neither is re-derivable from any later event.
The indexer does not attempt to recover these fields (e.g. by decoding
the settlement transaction's calldata) — see §13 for why that would be
out of scope even though it's technically possible.

### AttributionSettlement

| Event | Indexed args | Non-indexed args | Emitted by | State transition |
|---|---|---|---|---|
| `ExecutionSettled` | `executionId`, `modelId`, `provider` | `epoch`, `amount`, `servingConfidence` | `settleExecution` | One per settled execution |
| `EdgeAttributed` | `executionId`, `edgeId` | `childModelId`, `parentModelId`, `amount`, `effectiveConfidence` | `_distribute` (internal, per traversed finalized edge) | Audit trail only — informational, never a payment gate |
| `OwnerCredited` | `executionId`, `modelId`, `owner` | `amount` | `_distribute` (internal, once per visited graph node) | `claimable[owner] += amount` |
| `Claimed` | `recipient` | `amount` | `claim` | `claimable[recipient] = 0` |
| `EpochAdvanced` | — | `newEpoch` | `advanceEpoch` | admin — **not projected** |
| `ParameterUpdated` | — | `name`, `value` | 2 admin setters | admin — **not projected** |

`UsageProofConsumed` and `ExecutionSettled` are emitted in the same
transaction (the former from `ExecutionRegistry`, called mid-way through
`AttributionSettlement.settleExecution`), correlated by the shared
`executionId`. Together they cover `executionId`, `provider`, `modelId`,
`requestHash`, `epoch`, `amount`, `servingConfidence` — everything the
`executions` projection stores. A node beyond
`maxAncestorsPerSettlement` is silently truncated by the contract itself
(no event for that node at all) — the indexer does not, and must not,
invent a credit for it; the chain's own truncation and the indexer's
silence about it agree exactly.

### TrainingProvenanceRegistry

| Event | Indexed args | Non-indexed args | Emitted by | State transition |
|---|---|---|---|---|
| `ProvenanceRegistered` | `childModelId`, `baseModelId`, `provider` | `registrant`, `commitment`, `taskId` | `registerProvenance` | Immutable record created |

**Important gap, verified directly:** the event does **not** carry
`baseModelHash`, `datasetRootHash`, `scriptHash`, `resultRootHash`,
`evidenceURI`, or `issuedAt`/`registeredAt` — only the two model IDs,
`provider`, `registrant`, `commitment`, and `taskId`. `commitment` here
is `hashClaim(claim)`, the same value `TrainingProvenanceRegistry.
evidenceHashOf`/`matchesEdge` compute from the stored record — so the
indexer's projection of `commitment` is provably identical to what a
direct `evidenceHashOf` call would return (both are the same
deterministic hash of the same fields), even though the underlying
fields it was computed from aren't individually available from the
event. The rest of the record (dataset root, script hash, evidence URI,
etc.) is available only via a direct read
(`TrainingProvenanceRegistry.getProvenance`, already exposed by
`sdk/src/read.ts`) — the indexer does not duplicate it.

## 2. Category discipline (what's directly emitted vs read vs inferred)

Every projected field is one of:

- **A — directly emitted.** Copied verbatim from an event argument.
- **B — reconstructed from prior events (+ block metadata).** E.g. a
  model's `status` is `Active` until a later `ModelRevoked` event is
  seen; an edge's finalized/rejected/challenged state is folded forward
  from the sequence of `LineageEdgeChallenged`/`Resolved`/`Finalized`
  events for that `edgeId`; `created_at`/`registered_at` timestamps are
  the *block timestamp* of the event's own block (fetched once per
  block during ingestion and cached — this is the same value
  `block.timestamp` held inside the transaction that emitted the event,
  not a re-derivation of anything).
- **C — read from current contract state.** Nothing in the shipped
  projection tables uses this category — see §4 for the one place it
  was considered (provenance's non-emitted fields) and deliberately left
  to the SDK's direct-read path instead, so the indexer's own database
  never needs a live RPC call to answer a query.
- **D — inferred.** Never done. Anywhere the chain doesn't give the
  indexer enough to state a fact directly (A) or derive it deterministically
  from prior canonical events (B), the indexer omits the field rather
  than guessing at it. The `responseHash`/`chatId`/`signer` gap on
  `UsageProofConsumed` and the full-claim-fields gap on
  `ProvenanceRegistered` (§1) are both handled this way.

## 3. Confidence-axis separation

The indexer projects `edges.confidence_level` (lineage confidence,
`CascadeRegistry`) and `executions.serving_confidence` /
`edge_attributions.effective_confidence` (serving confidence and its
per-edge minimum with lineage confidence, `AttributionSettlement`) as
entirely separate columns in separate tables. Nothing in the projection
layer merges them into a single score, infers a "was this served
cryptographically" fact from a lineage edge's confidence level alone, or
vice versa. `effective_confidence` on `edge_attributions` is stored
exactly as emitted — an audit trail value the contract itself computed
via `min(edge confidence, serving confidence)` — never recomputed
independently by the indexer (that would risk a second, potentially
drifting confidence model; instead the indexer trusts and stores the
contract's own arithmetic, the same "wrap, don't reimplement" discipline
`sdk/` established in ADR 0012).

## 4. What is intentionally not projected

- `ParameterUpdated`/`EpochAdvanced`/`ResolverUpdated` (protocol
  parameters, current epoch, resolver address) — not requested by any
  query surface this phase defines; these are cheap to read live via the
  SDK when actually needed, and projecting them would mean tracking
  point-in-time historical parameter values for no consumer.
- `LineageEdge.evidenceHash` and `LineageEdge.challengeDeadline` — not
  emitted by `LineageEdgeRegistered` at all. `evidenceHash` would need a
  direct contract read; `challengeDeadline` would need historically
  correct replay of every `ParameterUpdated("challengeWindow", ...)`
  event to compute what the window *was* at each edge's registration
  time (the parameter is admin-mutable). Both are available directly via
  `client.read.getEdge(edgeId)` in the SDK — already the correct,
  authoritative source for exactly these two fields — so the indexer
  does not duplicate them.
- Full `TrainingProvenance` record fields beyond what `ProvenanceRegistered`
  emits — see §1. Available via `client.read.getProvenance(modelId)`.
- `UsageProof.responseHash`, `.chatId`, `.modelCommitment`, `.signer` —
  see §1. Not available from any event; not reconstructed by decoding
  transaction calldata (a deliberate scope decision, not an oversight —
  see §13).

## 5. Canonical event identity

Every stored event row carries: `chain_id`, `contract_address`,
`event_name`, `block_number`, `block_hash`, `transaction_hash`,
`transaction_index`, `log_index`, `block_timestamp`, and the normalized
JSON payload. The **unique constraint is `(chain_id, block_hash,
log_index)`** — `log_index` is block-scoped (unique across every log in
a block, regardless of which contract or transaction emitted it) per
standard `eth_getLogs` semantics, and `block_hash` (rather than
`block_number`) is the part of the key that makes a reorged block's logs
a genuinely distinct row from the original block's logs at the same
number, which is exactly the property reorg recovery needs. A locally
generated autoincrement `id` exists purely as a convenience join key —
never the identity a caller or another table relies on for correctness.

## 6. Synchronization algorithm

1. On startup, read `sync_state` (empty on a fresh database — see
   `config.startBlock`, normally the contracts' deployment block).
2. Compute `safeHead = latestBlock - config.confirmations`. Never ingest
   past `safeHead` in ordinary operation.
3. **Tip-hash check** (see ADR 0013): if `sync_state` has a prior
   checkpoint, re-fetch the live hash at that block number. A mismatch
   triggers reorg recovery (§8) before any forward ingestion happens.
4. Fetch logs for all four contract addresses in `config.chunkBlocks`
   -sized ranges (default 2000 blocks/request — one `eth_getLogs` call
   per chunk covering all four addresses at once, not four separate
   per-contract calls) from `lastIngestedBlock + 1` to `safeHead`.
5. Decode each log using the emitting contract's `ethers.Interface`,
   built from the SDK's generated ABIs (`sdk/src/abis`) — the indexer
   does not hand-maintain a second copy of any event signature.
6. Sort the whole chunk's logs by `(blockNumber, logIndex)` — the
   canonical, deterministic order — before applying any of them.
7. For each log, in that order, in one database transaction: insert the
   canonical event row (`INSERT OR IGNORE`, keyed by §5's constraint);
   if the insert actually added a new row (not a duplicate), apply the
   corresponding projection update.
8. Advance and persist `sync_state` to the chunk's last block.
9. Repeat until `lastIngestedBlock == safeHead`, then idle/poll.

## 7. Reorg strategy

See ADR 0013 for the full reasoning. Summary: confirmation-depth cushion
first, cheap tip-hash checkpoint to detect anything that gets past that
cushion, and — only on an actual detected mismatch — locate the last
still-canonical block by walking backward through the distinct
`(block_number, block_hash)` pairs already present in the stored
`events` table, delete every event at or after the divergence point, and
rebuild every projection table from the remaining events by replaying
them in canonical order (the same code path a full `--from-genesis`
resync uses).

## 8. Rebuild / resync

`indexer resync --from-genesis` (also exercised directly by tests) wipes
every projection table, keeps (or re-ingests) the `events` table, and
replays it start to finish. This is the same code path reorg recovery
uses for the affected tail of history. There is no hidden dependence on
insertion order, wall-clock time, or in-process memory anywhere in
projection application — every apply function is a pure function of
`(current projection row, canonical event payload)`.

## 9. Consistency model

The indexer's database is a convenience cache, never an authority. Two
concrete guarantees this implies:

- A caller who needs a security-critical fact (verifying a `UsageProof`
  before paying gas to submit it, checking a model's *current*
  registered commitment before trusting a serving claim, etc.) uses the
  SDK's direct contract calls (`sdk/src/read.ts`, `sdk/src/usage.ts`),
  which the indexer does not sit in front of and cannot be substituted
  for. `sdk/` has zero dependency on `indexer/` in either direction.
- Wherever the indexed projection and a live contract read would
  disagree (e.g. the indexer is a few blocks behind `safeHead`, or a
  reorg it hasn't yet detected has occurred), the chain is correct and
  the indexer is stale — never the reverse. The indexer exposes its own
  lag (`getSyncStatus()`) precisely so a caller can decide whether that
  staleness matters for what they're about to do.

## 10. Query surface

All list/event queries paginate by a cursor over `(block_number,
log_index)` (or, for entities whose own natural registration event
defines that ordering, the entity's `first_seen_block`/
`first_seen_log_index`) — ascending, deterministic, and derived
entirely from canonical chain order, never from SQLite's physical row
order or insertion time.

| Query | Returns |
|---|---|
| `getModel(modelId)` | Current projected `Model` row, or `null` |
| `listModels({limit, cursor})` | Models in registration order |
| `getEdge(edgeId)` | Current projected edge row |
| `getParents(modelId)` | Edges where `childModelId == modelId` |
| `getChildren(modelId)` | Edges where `parentModelId == modelId` |
| `getModelLineage(modelId)` | `{ parents, children }` combined |
| `getProvider(provider)` | Provider mode + signer count summary |
| `getProviderSigners(provider)` | Current signers (`SignerRevoked` clears one) |
| `getTrainingProvenance(modelId)` | Projected `ProvenanceRegistered` fields |
| `getExecution(executionId)` | Consumption + settlement fields, joined |
| `getExecutionAttribution(executionId)` | `{ edgeAttributions[], ownerCredits[] }` for one settled execution |
| `getClaimable(owner)` | Running `claimable` balance derived from `OwnerCredited`/`Claimed` |
| `getClaims(owner)` | `Claimed` event history for `owner` |
| `getEvents({contract?, eventName?, fromBlock?, toBlock?, limit, cursor})` | Raw canonical event rows |
| `getSyncStatus()` | `{ chainId, lastIndexedBlock, lastIndexedBlockHash, headBlock, safeHead, lagBlocks }` |

No generic query language, no arbitrary filter DSL — every query above
exists because §1's event inventory and the phase brief's own example
list justify it, not because it might be useful later.

## 11. Operational observability

Structured JSON log lines (no logging framework — matches
`relayer/src/logger.ts`'s own minimal precedent) for: sync tick
start/end with block range and event count, RPC failures (with retry
outcome), reorg detection and recovery (divergence point, blocks rolled
back), and per-event projection failures (which never silently drop an
event — a projection failure aborts the transaction for that event
rather than partially applying it, and is surfaced as a startup-blocking
error rather than skipped).

## 12. Known limitations

- `node:sqlite` is an experimental Node API (ADR 0013) — accepted, not
  hidden.
- Reorg recovery cost is `O(events since genesis)`, not `O(events rolled
  back)` — a deliberate trade-off (ADR 0013), fine at this phase's
  scope.
- The indexer is single-process, single-writer. Nothing in this phase
  needed horizontal scaling, and adding it would be exactly the kind of
  speculative complexity the phase brief says not to add.
- `UsageProof.responseHash`/`.chatId`/`.modelCommitment`/`.signer` and
  most `TrainingProvenanceClaim` fields are not indexed — see §4. A
  consumer needing them must already hold the original signed proof/claim
  off-chain, or read the relevant field directly via the SDK.

## 13. Pre-coding reconnaissance findings

Two things surfaced while producing §1's inventory, before any indexer
code was written, per the phase brief's "STOP and report before
implementing" instruction. Neither turned out to block this phase —
both are recorded here rather than silently fixed or silently ignored.

**A stale architectural description, now corrected.** Before this phase,
`docs/protocol-spec.md` §3 and `docs/architecture.md`'s repository-layout
table both described Phase 9 as an off-chain component that computes a
full DAG split and hands the chain a "compact, already-computed" result
to verify — the *original* Phase 0-era sketch, written before
`AttributionSettlement` existed. `docs/protocol-spec.md` §4 (written once
Phase 4 actually shipped) already flags this directly: Phase 4 was built
without that indexer, and `_distribute` performs the full bounded
recursive traversal **on-chain**, one execution at a time — confirmed by
reading `AttributionSettlement.sol` directly in this phase's own
reconnaissance, not assumed from either doc. §3's paragraph and
`architecture.md`'s table entry were the only places that still
described the superseded design; both are corrected as part of this
phase's documentation changes to match §4 and the actual contract. This
did not block implementation — the current phase brief and the real,
already-deployed contracts agree with each other throughout; only a
leftover paragraph from before Phase 4 existed was wrong, and it is fixed
rather than propagated into a second document.

**A second stale description, also corrected.** `docs/security-invariants.md`'s
INV-6 had the same problem as `protocol-spec.md` §3: it said weakest-link
confidence resolution was "enforced in the off-chain resolver (Phase 9)"
and that "the on-chain contract... never computes a path-level aggregate
itself" — also false since Phase 4, which built both
`AttributionSettlement._distribute`'s per-edge `min(edge, serving)`
computation and `CascadeRegistry.pathConfidence` directly on-chain.
Corrected in the same pass as §3, for the same reason: this phase's own
event inventory required reading `AttributionSettlement.sol` line by
line, which is what surfaced it.

**A deliberate scope boundary, not a discrepancy: transaction-calldata
decoding.** §1 and §4 note that `UsageProofConsumed` doesn't emit
`responseHash`, `chatId`, `modelCommitment`, or the recovered `signer`
address. These values *do* still exist on-chain, technically — as
calldata on the `settleExecution` transaction that triggered the event
— so decoding that transaction's input data against
`AttributionSettlement`'s ABI would recover them without violating "the
indexer never fabricates a fact." This was considered and deliberately
left undone for this phase: it would mean an extra `eth_getTransaction`
round trip per execution (a real cost the brief's "avoid one RPC request
per entity where possible" guidance argues against by default), and
nothing in this phase's required query surface (§10) or the phase
brief's own field list actually asks for these values back out of the
indexer — a caller that already submitted or received the proof already
has them. If a future consumer genuinely needs them indexed, decoding
`settleExecution` calldata is the correct, already-identified mechanism
to add — deliberately not added speculatively now.
