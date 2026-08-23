# Cascade — Security Invariants

Numbered so tests can reference them directly by ID. Each one is either
enforced in `CascadeRegistry`/`AttributionSettlement` code, or explicitly
marked as an economic (not cryptographic) property.

## Lineage invariants

- **INV-1 (no self-parent).** `childModelId != parentModelId` for any edge,
  checked at registration.
- **INV-2 (bounded acyclicity).** No edge may be registered if the proposed
  `parentModelId` is already reachable as a descendant of `childModelId`
  within `MAX_DEPTH` hops. `MAX_DEPTH` defaults to 8, configurable at
  deployment.
- **INV-3 (bounded royalty allocation).** The sum of `royaltyBps` across all
  of a single child's *direct* parent edges never exceeds `MAX_PARENT_BPS`
  (default 5000 = 50%), leaving the remainder to the model owner.
- **INV-4 (edge immutability after finalization).** Once an edge's status is
  `Finalized`, its `confidenceLevel` and `royaltyBps` cannot be changed.
  Revocation is possible (see INV-5) but never retroactive.
- **INV-5 (non-retroactive revocation).** Revoking a model or an edge stops
  it from being used as a parent in *future* edge registrations and *future*
  epochs' settlement. It never claws back a balance already credited from a
  prior, already-closed epoch.
- **INV-6 (weakest-link confidence).** The effective confidence of any
  multi-hop path is `min()` over its edges, never an average, never
  inherited from a stronger ancestor. **Superseded by Phase 4 — enforced
  on-chain, not off-chain.** This originally assumed an off-chain
  resolver (Phase 9) would compute path-level confidence; Phase 4 built
  `AttributionSettlement._distribute` to compute
  `min(edge confidence, serving confidence)` per traversed edge
  on-chain instead (emitted as `EdgeAttributed.effectiveConfidence`),
  and `CascadeRegistry.pathConfidence` separately computes the same
  weakest-link `min()` on-chain for a caller-supplied path. Phase 9's
  indexer does not recompute this a third time — it stores exactly the
  `effectiveConfidence` value the contract already computed (see
  `docs/indexer.md` §3), consistent with the "wrap, don't reimplement"
  discipline `sdk/`'s ADR 0012 established for the same reason.

## Challenge invariants

- **INV-7 (stake floor).** Registration reverts if `msg.value < MIN_STAKE`.
- **INV-8 (challenge bond floor).** Challenging reverts if
  `msg.value < CHALLENGE_BOND`.
- **INV-9 (challenge window).** An edge cannot be finalized before
  `block.timestamp >= challengeDeadline`, and cannot be finalized at all
  while `status == Challenged` and unresolved.
- **INV-10 (challenge outcome is exclusive).** A resolved challenge moves an
  edge to exactly one of `Finalized` or `Rejected`; it can never return to
  `Pending`.
- **INV-11 (loser forfeits).** A successful challenge forfeits the
  registrant's stake to the challenger (minus protocol fee, if any); a
  failed challenge forfeits the challenger's bond to the registrant. No
  outcome returns both bonds to both parties — that would make challenging
  free, reopening the griefing attack in `docs/threat-model.md` #15.

## Settlement invariants

- **INV-12 (replay uniqueness).** A `UsageProof` cannot be settled twice.
  Replay protection is not a nonce — there is no `nonce` field on
  `UsageProof` and none is signer-chosen. It is the deterministic
  `executionId = keccak256(provider, modelId, requestHash, responseHash)`
  (`ExecutionRegistry.hashExecutionId`), tracked in `executionConsumed`
  and checked by `consumeUsageProof`; consumed exactly once, globally,
  across all epochs. See `docs/protocol-spec.md` §2.
- **INV-13 (epoch validity, not batching).** `settleExecution` only
  accepts a proof whose `epoch` equals `AttributionSettlement.currentEpoch`
  at submission time; a proof from a past or future epoch reverts
  (`InvalidEpoch`). `epoch` is a coarse validity/staleness filter, not a
  settlement-batching or uniqueness key — any number of independent
  executions may settle within one epoch, each protected individually by
  INV-12's replay check, not by epoch. `currentEpoch` only advances via
  the owner-gated `advanceEpoch`. See `docs/protocol-spec.md` §4.
- **INV-14 (conservation).** For any settled epoch, the sum of amounts
  credited to all claimable balances for a given model's usage never
  exceeds the total attribution fees actually deposited for that model in
  that epoch. Dust from integer division accumulates to a disclosed pool,
  never silently vanishes and never silently over-allocates.
- **INV-15 (recipient derivation).** A claimable balance's recipient address
  is always computed from `CascadeRegistry` state at settlement time, never
  accepted as a raw parameter from whoever submits the settlement
  transaction.
- **INV-16 (pull payment only).** `AttributionSettlement` never pushes funds
  to an arbitrary address inside a loop. Recipients call `claim()`
  themselves. This is both a reentrancy mitigation and a liveness property —
  one broken or malicious recipient address cannot block payment to anyone
  else.

## Settlement invariants (Phase 4, `AttributionSettlement`)

- **INV-17 (confidence composition, per edge, never gating).**
  `effectiveConfidence = min(edge.confidenceLevel, servingConfidence)`,
  computed independently for every traversed edge, never averaged, never
  inherited from a stronger edge elsewhere in the path. It is emitted for
  audit purposes and never blocks or reduces a payment — see
  `docs/protocol-spec.md` §6 and ADR 0006.
- **INV-18 (finalized-only traversal).** Only `Finalized` edges are walked.
  `Pending`, `Challenged`, and `Rejected` edges contribute nothing to
  attribution, and the amount that would have flowed through them stays
  folded into the residual of the nearer node instead.
- **INV-19 (bounded traversal, two independent axes).** Traversal is capped
  by both `CascadeRegistry.maxDepth()` (depth) and
  `AttributionSettlement.maxAncestorsPerSettlement` (total nodes visited).
  Exceeding either cap truncates that branch of the traversal — it never
  reverts the settlement.
- **INV-20 (single notion of execution identity).** `AttributionSettlement`
  introduces no replay-protection state of its own; it calls
  `ExecutionRegistry.consumeUsageProof`, which owns `executionConsumed`
  (Phase 3). A second, settlement-side consumed-map would be redundant and
  a source of drift — deliberately not built.
- **INV-21 (exact funding, no relayer discretion over amount).**
  `settleExecution` requires `msg.value == attributionFeePerExecution`
  exactly. See ADR 0008 — the amount is never relayer- or
  submitter-supplied, by construction, not by convention.

## Training provenance invariants (Phase 6, `TrainingProvenanceRegistry`)

- **INV-22 (immutability).** A `TrainingProvenance` record, once
  registered for a `childModelId`, can never be updated or replaced — no
  update function exists. A second `registerProvenance` call for the same
  `childModelId` always reverts, including with corrected/different
  values.
- **INV-23 (dual authorization).** Registration requires both
  `msg.sender == CascadeRegistry.getModel(childModelId).owner` and an
  EIP-712 signature from a signer registered in
  `ExecutionRegistry.providerOfSigner`. Neither condition alone is
  sufficient — see ADR 0010.
- **INV-24 (commitment cross-check).** A claim's `resultRootHash` must
  equal the child model's registered `modelCommitment`, and its
  `baseModelHash` must equal the base model's registered
  `modelCommitment`, both checked at registration time. Mismatches revert
  (`ResultCommitmentMismatch`, `BaseModelCommitmentMismatch`) rather than
  registering a claim that contradicts already-registered state.
- **INV-25 (no enforced link to CascadeRegistry).** `CascadeRegistry` does
  not call into `TrainingProvenanceRegistry` and is not modified by its
  existence. The evidence-hash pairing between a Level 2 lineage edge and
  a provenance record is a checkable convention, not an on-chain-enforced
  invariant — see ADR 0010 and `docs/protocol-spec.md` §7.
- **INV-26 (axis independence preserved).** No code path in
  `TrainingProvenanceRegistry` can affect `ExecutionRegistry`'s
  `servingConfidence` computation. Level 2 evidence cannot become Level 1
  by construction, not by policy — proven directly in
  `contracts/test/TrainingProvenanceRegistry.test.ts`, consistent with
  INV-6's weakest-link rule and ADR 0006.

## Explicitly economic, not cryptographic

INV-6 through INV-11 bound *behavior* through stake and bonds; they do not
make a Level 3 (or unresolved Level 2) lineage claim true. See
`docs/trust-model.md`, "Provenance," for the honest version of this
statement.
