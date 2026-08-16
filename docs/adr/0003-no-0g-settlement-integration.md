# ADR 0003 — Cascade does not integrate with 0G's settlement contract

## Status
Accepted

## Context
Three research passes attempted to locate 0G's Compute/Serving payment
contract source — checked official repositories, npm packages, and
ChainScan. A control search for the analogous Storage contracts succeeded
immediately (`0glabs/0g-storage-contracts` is public). The same method
applied to Compute/Serving repeatedly found nothing. This is treated as a
considered negative result: the source is not publicly available, not that
it hasn't been looked for hard enough.

Separately, 0G's own settlement is provider-initiated and batched at
scheduled intervals, not atomic per inference call — confirmed from 0G's
own documentation. There is no evidence of a hook or extension point for a
third-party contract to participate in that settlement transaction.

## Decision
Cascade's `AttributionSettlement` is a fully separate system. The
attribution fee is paid by the buyer, directly into Cascade's contract, in
parallel with (not extracted from) the buyer's ordinary 0G inference
payment. Cascade never assumes anything about what 0G's settlement contract
checks internally, and never attempts to hook, wrap, or redirect it.

## Consequences
- No provider-default risk in Cascade's trust model — provider insolvency
  toward 0G is 0G's own risk, never inherited.
- Buyers see two line items (0G's serving fee, Cascade's attribution fee)
  rather than one. Accepted as the honest cost of not depending on
  unconfirmed internals.
- If 0G later publishes its settlement contract source, or offers a
  documented extension point, this decision should be revisited — noted in
  `docs/architecture.md` "future upgrades" once that section exists.
