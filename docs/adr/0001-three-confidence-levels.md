# ADR 0001 — Three confidence levels, not two, and never binary

## Status
Accepted

## Context
The original Cascade thesis proposed a two-tier model: models fine-tuned
through 0G ("Tier 1", treated as cryptographically verified) versus
everything else ("Tier 2", optimistic/staked). Three rounds of adversarial
research (`The Cascade Audit`, `The Cascade Gate`, `The Cascade Verdict`)
found that 0G's fine-tuning attestation does not, on public evidence, bind
its output to what's later served at inference time — so "Tier 1" as
originally defined conflated two different guarantees: evidence about how a
model was *trained*, and evidence about what's actually *running* when it's
served.

Separately, that research found a real, buildable way to close the serving
side of the gap: a Cascade-authored attested serving wrapper that verifies
a model's hash before loading it, using the same TEE measurement mechanism
0G already uses for its own deployment-configuration checks.

## Decision
Replace the two-tier model with three explicit confidence levels, assigned
**per lineage edge**, never per model and never per DAG:

1. **Cryptographically bound** — served through the Cascade wrapper.
2. **Attested training provenance** — 0G fine-tuning evidence, unbound at
   serving time.
3. **Declared** — staked, challengeable claim.

A path's effective confidence is its weakest edge (INV-6). No confidence
level is ever collapsed into a single "verified" boolean anywhere in the
protocol, the contracts, or the documentation.

## Consequences
- `LineageEdge.confidenceLevel` is a required field on every edge, not an
  optional flag.
- The wrapper (Phase 7) becomes a first-class MVP component, not a future
  enhancement — it's the only path to Level 1.
- Every public-facing string describing Cascade must be level-specific. See
  `docs/protocol-spec.md` §5.
- More implementation surface than the original two-tier design. Accepted
  as the cost of not overstating what the system proves.
