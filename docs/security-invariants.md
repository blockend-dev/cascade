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
  inherited from a stronger ancestor. Enforced in the off-chain resolver
  (Phase 9) and asserted by unit tests against hand-constructed DAGs; the
  on-chain contract stores per-edge confidence and never computes a
  path-level aggregate itself.

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

- **INV-12 (replay uniqueness).** A `UsageProof.nonce` can be consumed
  exactly once, globally, across all epochs.
- **INV-13 (epoch exclusivity).** A given epoch, once settled, cannot be
  settled again — the settlement submission function is a one-shot
  transition per epoch per model.
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

## Explicitly economic, not cryptographic

INV-6 through INV-11 bound *behavior* through stake and bonds; they do not
make a Level 3 (or unresolved Level 2) lineage claim true. See
`docs/trust-model.md`, "Provenance," for the honest version of this
statement.
