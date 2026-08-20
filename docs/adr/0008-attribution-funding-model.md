# ADR 0008 — Attribution funding is a protocol-configured flat fee, paid exactly, per execution

## Status
Accepted

## Context
ADR 0003 established *who* pays Cascade's attribution fee (the buyer,
directly, parallel to 0G's own serving fee) but never specified the exact
on-chain mechanism or how the per-execution amount is determined. Building
`AttributionSettlement` forced this gap into the open: a `UsageProof`
(Phase 3) deliberately carries no `amount` field, and the Phase 4 brief
explicitly forbids a relayer- or submitter-supplied amount ("The contract
must NOT... accept arbitrary amounts supplied by the relayer"). Something
has to determine the number, and it cannot be calldata.

## Decision
`AttributionSettlement.attributionFeePerExecution` is a single,
owner-configurable `uint256` (default `0.001 ether`), applied uniformly to
every settled execution — the same pattern already used for every other
economic parameter in this codebase (`CascadeRegistry.minStake`,
`.challengeBondAmount`, `ExecutionRegistry.proofValidityWindow`, etc.).
`settleExecution` requires `msg.value == attributionFeePerExecution`
exactly — no over/under-funding, no refund logic, no relayer discretion of
any kind over the number. Whoever calls `settleExecution` (buyer or
relayer acting for them) simply pays the fixed, publicly-known rate.

This is deliberately the smallest mechanism that satisfies the hard
constraint. Per-model or per-provider variable rates, a pre-funded
balance/deposit-account model, or ERC-20 settlement were all considered and
rejected as unnecessary complexity for an MVP that a flat, protocol-wide
rate already serves — any of them can be layered in later without breaking
this ADR's interface if real usage shows a flat rate is insufficient.

## Consequences
- One fee, one asset (native token, matching the project's existing
  preference — see prior Cascade research on native-vs-ERC20 settlement),
  applied identically regardless of model, provider, or confidence level.
  Simple to audit, simple to reason about conservation for.
- A relayer cannot influence attribution economics in any way — not the
  recipient (ADR established in Phase 3/4 design), not the amount (this
  ADR). It can only submit, delay, or withhold.
- Future work, if needed: per-model configurable rates (would require a
  registry of rates keyed by modelId, deliberately deferred), or moving to
  a pre-funded balance model if per-transaction exact-payment UX proves too
  rigid for real relayers. Neither is implemented now.
