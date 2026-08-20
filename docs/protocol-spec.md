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

## 4. Settlement flow

```
verified usage event (0G TEE-signed response, independently re-checkable)
        ↓
UsageProof constructed + EIP-712 signed by whoever submits it (the relayer,
or anyone else holding the same public evidence)
        ↓
submitted to AttributionSettlement (permissionless — see docs/threat-model.md #9)
        ↓
contract verifies: nonce not previously consumed; recovered signer matches
a registered provider/relayer role appropriate to the proof type; epoch is
open
        ↓
usage accepted into that epoch's accumulator (off-chain until epoch close)
        ↓
epoch close: indexer computes the DAG-resolved split for every model that
had usage this epoch, off-chain
        ↓
settlement submission: compact per-model split, checked on-chain against
registered edges' royaltyBps and the weakest-link confidence rule — the
contract does NOT re-walk the DAG, it verifies the submitted split sums
correctly and matches what the registered graph allows
        ↓
claimable balances credited per ancestor (pull payment)
        ↓
ancestor calls claim() — checks-effects-interactions, reentrancy-guarded
```

**Why 0G's own serving payment is not touched.** Per ADR 0003, Cascade's
attribution fee is paid by the buyer in parallel to 0G's own inference fee,
not skimmed from a provider's 0G payout. This removes provider-default risk
from Cascade's trust model entirely — it was never Cascade's to inherit.

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
6. **Not yet built:** Phase 4's `AttributionSettlement` will take a batch of
   `VerifiedUsage` results per epoch, resolve each `modelId`'s finalized
   lineage DAG in `CascadeRegistry`, and credit ancestors proportionally,
   at a trust level of `min(servingConfidence, weakest finalized edge along
   the path)` — see ADR 0006. This step does not exist in the codebase yet;
   it is described here only so the boundary Phase 3 hands off is legible
   before Phase 4 is designed against it.

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
