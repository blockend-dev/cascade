# ADR 0010 — TrainingProvenanceRegistry: a minimal, independent contract, not a CascadeRegistry extension

## Status
Accepted

## Context
Level 2 (`AttestedTraining`) has existed as a confidence-level value since
ADR 0001, and `LineageEdge.evidenceHash` has always been able to carry a
commitment to "the 0G fine-tuning completion record" (`docs/protocol-spec.md`
§1). But nothing on-chain gave that commitment any structure: any caller
could register an edge as `AttestedTraining` with an arbitrary `bytes32`,
indistinguishable in the contract's eyes from a bare Level 3 claim. Phase 6
closes that gap — not by inventing a stronger cryptographic guarantee (the
underlying 0G evidence is exactly as strong as prior research established
it to be, no stronger), but by giving Level 2 claims a real, checkable,
structured on-chain shape.

Two alternatives were rejected:

- **Extending `CascadeRegistry`** (`LineageEdge` gains more fields) would
  modify a frozen, tested Phase 1–2 contract for a concern that only
  applies to one confidence level out of three, and would conflate
  "the general per-edge evidence commitment" (needed for all three levels)
  with "the specific structured shape of a 0G fine-tuning record" (needed
  for exactly one). It also directly contradicts "no changes to completed
  phases unless strictly necessary" — a new contract makes it unnecessary.
- **A larger provenance subsystem** (its own challenge/staking mechanism,
  mirroring `CascadeRegistry`'s) was rejected as duplicated machinery.
  A false Level 2 claim is exactly as punishable as a false Level 3 claim
  today, through the existing `CascadeRegistry` stake-and-challenge flow —
  Phase 6 doesn't need a second one.

## Decision
`TrainingProvenanceRegistry` is a new contract holding an immutable
`mapping(bytes32 childModelId => TrainingProvenance)`. It:

- Reads `CascadeRegistry.getModel` (view only) to confirm both the child
  and claimed base model are registered, to authorize the caller as the
  child model's owner, and to cross-check the claimed base/result
  commitments against what's actually registered.
- Reads `ExecutionRegistry.providerOfSigner` (view only) to confirm the
  claim was signed by a registered 0G provider's signer key — reusing the
  exact trust anchor Phase 3 already established for serving evidence,
  now also applied to training evidence, since 0G's provider
  infrastructure runs both.
- Requires **dual authorization**, mirroring two conventions already in
  use elsewhere in this codebase rather than inventing a third: the
  registering transaction must come from the child model's registered
  owner (`CascadeRegistry`'s `msg.sender == owner` pattern), and the claim
  itself must carry a registered provider's EIP-712 signature (Phase 3's
  pattern). Neither party alone can produce a valid registration — the
  owner can't fabricate provenance without a real provider's signature,
  and a provider's signature alone doesn't let it register claims against
  someone else's model.
- Computes `evidenceHash` as the literal EIP-712 struct hash of the signed
  claim (`hashClaim`, mirroring `ExecutionRegistry.hashUsageProof`) — the
  same value a `CascadeRegistry` Level 2 edge's `evidenceHash` should
  carry. This is a convention, not an enforced on-chain link:
  `CascadeRegistry.registerLineageEdge` is unmodified and does not call
  into this contract. Anyone — an indexer, a challenger, a UI — can
  independently recompute `hashClaim` from a registered
  `TrainingProvenance` record and compare it to a specific edge's
  `evidenceHash` to confirm or refute the pairing. A mismatched or
  entirely fabricated pairing is a false Level 2 claim, challengeable
  through `CascadeRegistry`'s existing mechanism exactly as a false
  Level 3 claim would be — no new enforcement path was built, because the
  existing one already covers it.
- Records are immutable once set: no update function exists.

## Consequences
- Zero changes to `CascadeRegistry`, `ExecutionRegistry`, or
  `AttributionSettlement`. Confirmed by running all 110 pre-existing tests
  unmodified.
- The bridge between a `TrainingProvenance` record and a `CascadeRegistry`
  edge is a convention (matching hashes), not a contract-enforced
  invariant. This is a deliberate choice, not an oversight: enforcing it
  on-chain would require `CascadeRegistry` to call out to a contract that
  didn't exist when it was written, for a check that only matters to one
  of three confidence levels. The existing challenge mechanism already
  prices dishonesty in the case where the convention isn't followed.
- "Attempting to represent Level 2 as Level 1" is not prevented by this
  contract specifically — it's structurally impossible regardless of what
  this contract does, because `servingConfidence` (the only source of
  Level 1 status) lives entirely in `ExecutionRegistry` and has no
  dependency on `CascadeRegistry`'s lineage-edge confidence at all
  (ADR 0006). A mislabeled lineage edge cannot raise the `min()` the
  settlement layer actually uses. Tested directly in
  `contracts/test/TrainingProvenanceRegistry.test.ts`, not merely
  asserted here.
- Level 2's epistemic status is unchanged by this ADR: a registered
  provider's signature over declared claim fields is a real,
  non-repudiable attestation that a specific, identifiable party vouched
  for these values. It is not, and is never described as, proof that the
  declared inputs actually produced the declared output inside an
  attested computation — that binding remains unestablished, per prior
  research (`The Cascade Gate`, `The Cascade Verdict`), and this contract
  does not claim otherwise anywhere in its NatSpec or in
  `docs/protocol-spec.md`.
