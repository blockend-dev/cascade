# Cascade — Protocol Specification

## 1. Data model

### Model

```
Model
 ├── modelId          bytes32   keccak256(owner, salt) at registration — opaque identifier
 ├── owner             address   registered controller; may update metadata / revoke
 ├── modelCommitment   bytes32   content-addressed reference (0G Storage root hash, or
 │                                equivalent) to the served artifact. Immutable once set;
 │                                changing a model's weights means registering a new modelId.
 ├── metadataURI       string    pointer to the off-chain manifest (0G Storage) — free-text
 │                                description, dataset references, training script reference
 ├── status            enum      Active | Revoked
 └── createdAt         uint64
```

### LineageEdge

One edge = one claimed parent→child derivation relationship, with its own
confidence level, royalty share, and challenge state. A model may have
multiple parent edges (DAG, not tree — see §3).

```
LineageEdge
 ├── edgeId             bytes32   keccak256(childModelId, parentModelId)
 ├── childModelId        bytes32
 ├── parentModelId       bytes32
 ├── confidenceLevel     enum      Declared (Level 3) | AttestedTraining (Level 2) |
 │                                  CryptographicallyBound (Level 1)
 ├── royaltyBps          uint16    this edge's share of the child's attribution fee
 ├── evidenceHash        bytes32   commitment to the off-chain evidence manifest — a
 │                                  signed lineage declaration (Level 3), the 0G
 │                                  fine-tuning completion record (Level 2), or the
 │                                  wrapper's attested measurement reference (Level 1)
 ├── stake               uint256   posted by the registrant; forfeit on a successful
 │                                  challenge
 ├── challengeDeadline   uint64
 └── status              enum      Pending | Challenged | Finalized | Rejected
```

**Enum ordering is deliberate.** `ConfidenceLevel` is declared
`{ Declared, AttestedTraining, CryptographicallyBound }` — ascending
strength — so that "weakest edge on a path" is a plain `min()` over the
enum's underlying `uint8`, not a lookup table. Comments in the contract
map these to the user-facing "Level 3 / Level 2 / Level 1" terminology,
which counts down rather than up, on purpose: Level 1 is the strongest
claim Cascade can make, and code should never let the two numbering
schemes silently drift apart.

### UsageProof (canonical, off-chain, EIP-712 typed, implemented Phase 3)

```
UsageProof
 ├── modelId           bytes32   which registered Cascade model this usage is attributed to
 ├── modelCommitment   bytes32   what the signer claims was served — cross-checked
 │                                against CascadeRegistry's registered commitment;
 │                                a mismatch reverts, it does not merely downgrade
 │                                confidence
 ├── requestHash       bytes32   from the 0G TEE-signed payload
 ├── responseHash      bytes32   from the 0G TEE-signed payload
 ├── chatId            bytes32   0G's own response identifier, carried for
 │                                off-chain auditability — not the replay key
 ├── epoch             uint64    coarse settlement-epoch bucketing hint for
 │                                Phase 4; not itself part of replay protection
 └── issuedAt          uint64    signer's claimed signing time; checked against
                                  a configurable validity window (freshness,
                                  not replay protection — see below)
```

Two fields from the original sketch were deliberately dropped once Phase 3
was actually built:

- **`provider`** is not a field at all. It is *derived* — the verifier
  recovers the signer via ECDSA and looks up
  `ExecutionRegistry.providerOfSigner[signer]`. There is no calldata a
  relayer or attacker can supply to influence it, which is a stronger
  property than "the contract checks a supplied provider against the
  registered one."
- **`amount`** and any recipient concept are absent. Payment/attribution
  belongs to Phase 4 (`AttributionSettlement`, not yet built), which reads
  the *verified* output of this layer — it never lets a relayer supply a
  payment amount or recipient directly. See ADR 0003 and ADR 0005.

**Replay protection** does not use a relayer-chosen nonce. It's a derived
value: `executionId = keccak256(provider, modelId, requestHash,
responseHash)` (`ExecutionRegistry.hashExecutionId`) — deterministic,
collision-resistant against distinct executions, and cannot be gamed by
picking a convenient nonce, because there is no nonce to pick.

A `UsageProof` is not itself the 0G TEE signature — it is Cascade's own
EIP-712-typed record of a usage event, constructed and signed by whoever
holds a registered signer key (the provider or its enclave), then submitted
on-chain by anyone (typically a relayer). `ExecutionRegistry` independently
verifies every fact it can verify — the signer's registration, the model
commitment match, replay-uniqueness of the derived `executionId` — and
never trusts the submitter's transcription of any of it. See §4 and §6.

### Serving confidence vs. lineage confidence (ADR 0006)

`ConfidenceLevel` is reused across two independent axes, not duplicated and
not collapsed into one meaning:

- **Lineage confidence** (`CascadeRegistry`, unchanged): how strongly a
  parent→child derivation claim is backed. Any of the three levels.
- **Serving confidence** (`ExecutionRegistry`, new): how strongly one
  specific `UsageProof` establishes that the model actually served matches
  its registered commitment. Only ever `CryptographicallyBound` (provider
  registered in `CascadeWrapper` mode, commitment matches) or `Declared`
  (everything else) — `AttestedTraining` never applies here; it describes
  how a model came to exist, not what's being served this instant.

Phase 4's effective trust for a payout will be `min(serving confidence of
the triggering usage proof, weakest lineage-edge confidence along the
attribution path)`.

**Current honest status of `CascadeWrapper` mode:** owner-attested only,
with no cryptographic backing, pending Phase 7. See `docs/trust-model.md`.

## 2. EIP-712 domain

All off-chain-signed structures (lineage declarations, usage proofs) are
signed under one domain:

```
name:              "Cascade"
version:           "1"
chainId:           <0G chain id>
verifyingContract: <CascadeRegistry or AttributionSettlement address>
```

Binding `chainId` and `verifyingContract` into the domain separator closes
cross-chain and cross-contract replay by construction (EIP-712's own
guarantee, not a Cascade-specific one).

## 3. Lineage is a DAG; resolution is per-edge, weakest-link

A model may declare multiple parents (fine-tune merges, multi-source
distillation). `CascadeRegistry` stores edges, not trees. Two rules keep
this tractable:

- **No cycles.** At registration, a bounded ancestor walk (see
  `docs/security-invariants.md`, `MAX_DEPTH`) checks that `parentModelId` is
  not already a descendant of `childModelId`. The walk is capped, not
  unbounded — a would-be cycle beyond the cap is rejected as "cannot be
  verified acyclic within bounds," not silently accepted.
- **Confidence never launders upward.** The effective confidence of a
  multi-hop path A→B→C is `min(confidence(A→B), confidence(B→C))`, always.
  A Level-1 grandparent edge does not strengthen a Level-3 parent edge
  anywhere downstream of it.

Full graph resolution — computing every ancestor's proportional share
across an arbitrary DAG — happens **off-chain**, in the indexer (Phase 9).
The chain only ever verifies a compact, already-computed split against
registered `royaltyBps` values and signs off on the arithmetic. See
`docs/security-invariants.md` for the exact conservation invariant this
must satisfy.

## 4. Settlement flow (implemented Phase 4)

The original sketch of this section, written before `AttributionSettlement`
existed, assumed an off-chain indexer batching many executions per epoch
into one compact on-chain submission. Phase 4 was built without that
indexer (Phase 9 doesn't exist yet) — the actual, working, tested flow
settles **one execution per call**, with `epoch` as a coarse tag grouping
many independent calls, not a batched submission:

```
verified usage event (0G TEE-signed response, independently re-checkable)
        ↓
UsageProof constructed + EIP-712 signed by whoever holds a registered
signer key (the provider or its enclave)
        ↓
AttributionSettlement.settleExecution(proof, signature), payable, called
by anyone — permissionless, see docs/threat-model.md #9
        ↓
requires: proof.epoch == currentEpoch (InvalidEpoch otherwise); msg.value
== attributionFeePerExecution exactly (IncorrectFunding otherwise — see
ADR 0008, no relayer-chosen amount, ever)
        ↓
calls ExecutionRegistry.consumeUsageProof — Phase 3's own replay
protection (executionConsumed), reused directly, not reimplemented
        ↓
bounded recursive traversal of the model's finalized CascadeRegistry
lineage edges (§6), multiplicatively splitting the funded amount, capped
by both CascadeRegistry.maxDepth() and maxAncestorsPerSettlement
        ↓
claimable balances credited per current registered owner (pull payment)
        ↓
owner calls claim() — checks-effects-interactions, reentrancy-guarded
```

**Why 0G's own serving payment is not touched.** Per ADR 0003, Cascade's
attribution fee is paid by the buyer in parallel to 0G's own inference fee,
not skimmed from a provider's 0G payout. This removes provider-default risk
from Cascade's trust model entirely — it was never Cascade's to inherit.

A batching convenience layer (many executions, one relayer-submitted
transaction) remains reasonable future work — see §6 — but was not needed
to make settlement actually work end to end, and was deliberately left out
of Phase 4 to keep the settlement contract small enough to audit.

## 4a. Worked example — TEE evidence to a verified execution

1. A user calls model C through 0G Compute. 0G's provider infrastructure
   produces a TEE-signed response binding a request hash and a response
   hash to a registered 0G signer — this is 0G's own evidence, outside
   Cascade's control (see prior research: *The Cascade Gate*, *The Cascade
   Verdict*).
2. Whoever holds a Cascade-registered signer key for that provider (the
   provider itself, or its enclave) constructs a `UsageProof`: `modelId` =
   C's registered Cascade model id, `modelCommitment` = C's registered 0G
   Storage root hash, `requestHash`/`responseHash` copied from the 0G
   evidence, `chatId` copied from 0G's response identifier, `epoch` = the
   current settlement epoch, `issuedAt` = now. They sign it under the
   `Cascade` EIP-712 domain for the deployed `ExecutionRegistry`.
3. Anyone — typically a relayer, but not necessarily — submits `(proof,
   signature)` to `ExecutionRegistry.verifyUsageProof` (to check first) or
   directly to `consumeUsageProof` (to settle).
4. `ExecutionRegistry` recovers the signer via ECDSA, looks up
   `providerOfSigner[signer]` — this is where "provider" comes from; it was
   never in the calldata. It calls `CascadeRegistry.getModel(modelId)` and
   reverts if the returned `modelCommitment` doesn't match what was signed.
   It computes `executionId` and reverts if already consumed.
5. The call returns a `VerifiedUsage`: `{ signer, provider, modelId,
   executionId, requestHash, responseHash, servingConfidence }`. Every field
   is either recovered cryptographically or looked up from trusted
   contract state — none of it is an echo of attacker-controlled calldata.
6. `AttributionSettlement.settleExecution` (Phase 4, implemented) takes that
   `VerifiedUsage`, resolves `modelId`'s finalized lineage graph in
   `CascadeRegistry`, and credits ancestors proportionally. See §6 for the
   full mechanics — traversal, confidence composition, rounding, and the
   funding model.

## 5. What each confidence level is permitted to claim publicly

This section exists specifically so implementation and documentation cannot
drift apart. See `docs/trust-model.md` for the underlying reasoning.

- **Level 1:** "A genuine, registered 0G TEE signer produced this response,
  and the Cascade wrapper verified the served model's hash against the
  registered commitment before running inference."
- **Level 2:** "This model has 0G-attested training provenance: signed
  declared inputs and a checked output-hash. This is circumstantial,
  accountable evidence, not a cryptographic proof of derivation."
- **Level 3:** "This lineage is a staked, publicly challengeable claim by
  the model owner. It carries no cryptographic guarantee."

Forbidden regardless of level: "cryptographically bound to the fact that
model C was served" as a blanket claim; "proof of training" without a
hedge; "trustless" applied to anything Level 2 or 3.

## 6. AttributionSettlement (implemented Phase 4)

### Funding

One protocol-configured flat fee, `attributionFeePerExecution` (default
`0.001 ether`, owner-adjustable), required exactly as `msg.value` on every
`settleExecution` call — see ADR 0008. No relayer, submitter, or anyone
else ever supplies or influences the amount.

### Traversal and the multiplicative cascade

Given a served model's `amount` (the funded fee), `_distribute` walks its
**finalized** direct-parent edges only (`Pending`/`Challenged`/`Rejected`
edges are skipped — unfinalized or disputed lineage never receives
attribution). Each edge's registered `royaltyBps` is applied to the amount
flowing into *that specific node*, not to the original top-level amount —
matching `CascadeRegistry`'s own `totalParentBps` semantics, which are
scoped per-child. The parent's resulting share is then itself recursively
subject to the parent's *own* parent edges, cascading upward. Whatever
remains after a node's direct parents are paid is credited to that node's
current registered owner.

This means a diamond DAG (two different paths reaching the same ancestor)
credits that ancestor twice, once per path — intended behavior, not a bug;
each path is an independent, already-capped royalty agreement.

Traversal is bounded on two independent axes, both disclosed limitations
rather than silent failures or reverts:
- **Depth** — `CascadeRegistry.maxDepth()`, the same parameter that already
  bounds cycle detection at registration time. Reused, not duplicated.
- **Breadth/total nodes** — `maxAncestorsPerSettlement` (default 64), an
  `AttributionSettlement`-local cap independent of depth, closing the
  fan-out (`maxParentsPerModel`) side of the cost equation. Ancestors
  beyond either cap simply receive no credit for that settlement; the
  settlement itself never reverts due to graph size — a revert would be a
  liveness bug (a legitimately large graph could never settle at all).

### Confidence composition

Per edge traversed, `effectiveConfidence = min(edge.confidenceLevel,
triggering usage proof's servingConfidence)` (ADR 0006), emitted in
`EdgeAttributed`. **This does not gate payment.** A `Declared`-confidence
edge is still paid its full registered share — confidence is an audit
signal about how strongly a payout is backed, not a filter on whether it
happens. Gating on confidence would defeat the entire point of Level 3's
staked-and-challengeable design, whose security model *is* "pay unless
successfully challenged," not "don't pay until proven."

### Rounding

Every split uses floor-division integer arithmetic:
`parentShare = (amount * royaltyBps) / 10_000`. The residual credited to
each node's owner is `amount - sum(that node's parent shares)` — since
floor division only ever *loses* fractional value, never gains it, the
lost fraction is automatically folded into the residual of the node
closest to it. No separate dust pool exists or is needed: summed across an
entire settlement, `Σ OwnerCredited == msg.value`, exactly, every time —
verified directly in tests, not merely argued for.

### Replay and execution identity

`AttributionSettlement` introduces no second notion of execution identity.
It calls `ExecutionRegistry.consumeUsageProof`, which owns
`executionConsumed` (Phase 3) — a second, settlement-side replay map would
be redundant and a source of drift.

### Claims

Pull payment. `claimable[address]`, credited during `_distribute`, paid out
in full via `claim()` — checks-effects-interactions (balance zeroed before
the external call) plus `nonReentrant` as defense in depth. See
`contracts/src/mocks/ReentrantClaimer.sol` and its test for a live proof,
not just an assertion, that a malicious claimant cannot re-enter.

### Trust boundary — what this contract does not establish

`AttributionSettlement` never claims to prove model identity itself. It
settles according to whatever `ExecutionRegistry` already established for
that proof (§4a) — no stronger, no weaker. In particular, it does not
verify a 0G TEE quote, and it has no integration with 0G's own settlement
contract (ADR 0003) — the two payment systems remain fully parallel.

## 7. TrainingProvenanceRegistry (implemented Phase 6)

Structured on-chain representation of a Level 2 claim — see ADR 0010 for
the full architecture reasoning; this section is the data-model reference.

### What a registered `TrainingProvenance` record contains

```
TrainingProvenance
 ├── baseModelId       bytes32   the declared base model — a registered CascadeRegistry modelId
 ├── baseModelHash     bytes32   claimed base weight commitment — cross-checked against
 │                                 CascadeRegistry.getModel(baseModelId).modelCommitment at
 │                                 registration; mismatch reverts
 ├── datasetRootHash   bytes32   0G Storage root hash of the training dataset
 ├── scriptHash        bytes32   training script / config hash
 ├── resultRootHash    bytes32   claimed resulting weight commitment — cross-checked against
 │                                 CascadeRegistry.getModel(childModelId).modelCommitment;
 │                                 mismatch reverts
 ├── taskId            bytes32   opaque 0G fine-tuning task identifier
 ├── evidenceURI       string    pointer to the full off-chain manifest (0G Storage) — the
 │                                 detailed evidence itself is never stored on-chain
 ├── provider          address   derived from the registered ExecutionRegistry signer who
 │                                 signed the claim — never a signed field itself
 ├── registrant        address   the child model's owner, who submitted the transaction
 ├── issuedAt          uint64    provider-signed claim time
 └── registeredAt      uint64    on-chain registration time
```

### Dual authorization

`registerProvenance` requires both: `msg.sender == CascadeRegistry.getModel(childModelId).owner`
(the same ownership pattern `registerLineageEdge` already uses), and an
EIP-712 signature over the claim from a signer registered in
`ExecutionRegistry.providerOfSigner` (the same trust anchor `UsageProof`
verification already uses). Neither alone authorizes a registration.

### What this proves, and what it does not

A registered record proves: a specific, identifiable 0G provider
non-repudiably signed a claim naming these exact base/dataset/script/result
values, and those base/result commitments match what's independently
registered in `CascadeRegistry`. It does not prove the provider's training
job actually produced the declared output from the declared inputs — that
atomic binding has no public confirmation in 0G's fine-tuning
implementation (prior research: *The Cascade Gate*, *The Cascade Verdict*)
and this registry does not claim otherwise anywhere. This is exactly
Level 2's scope as defined in §5 — circumstantial, accountable evidence,
never described as proof of derivation.

### The bridge to CascadeRegistry — a convention, not an enforced link

`CascadeRegistry.registerLineageEdge` is unmodified and has no knowledge
of this contract. The connection is a hashing convention:
`evidenceHashOf(childModelId)` returns the same EIP-712 struct hash
(`hashClaim`) that should be passed as a Level 2 edge's `evidenceHash`.
Nothing on-chain enforces that pairing — anyone (an indexer, a challenger,
a UI) can call `matchesEdge` to check it independently. A mismatched or
fabricated pairing is a false Level 2 claim, challengeable through
`CascadeRegistry`'s existing stake-and-challenge mechanism exactly as a
false Level 3 claim would be. See ADR 0010 for why this indirection was
chosen over a direct on-chain call between the two contracts.

### Why mislabeling Level 2 as Level 1 doesn't work

Nothing stops a caller from registering a `CascadeRegistry` edge with
`ConfidenceLevel.CryptographicallyBound` while backing it with a
Level-2-sourced `evidenceHash` — `CascadeRegistry` doesn't know the
difference. But `AttributionSettlement`'s effective trust is
`min(lineage confidence, serving confidence)` (§6, ADR 0006), and
`servingConfidence` lives entirely in `ExecutionRegistry`, with zero
dependency on any `CascadeRegistry` lineage-edge label. A mislabeled edge
cannot raise the settlement layer's actual trust level above whatever
`servingConfidence` independently is. Verified directly, not just argued
for, in `contracts/test/TrainingProvenanceRegistry.test.ts`.
