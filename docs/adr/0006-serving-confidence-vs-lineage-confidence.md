# ADR 0006 — Serving confidence is a distinct axis from lineage-edge confidence

## Status
Accepted

## Context
`docs/protocol-spec.md` defines `ConfidenceLevel` (Declared / AttestedTraining
/ CryptographicallyBound) as a property of a `LineageEdge` — how strongly a
claimed parent→child derivation is backed. But the Level 1 definition itself
("served through the Cascade-authored attested wrapper, which verifies the
loaded model's hash before serving") is not a statement about *derivation* —
it's a statement about what's happening *right now, at serving time*: is the
model actually being served the one that was registered. That question has
nothing to do with any specific model's ancestry claim, and a `UsageProof`
(Phase 3) is exactly where it needs to be answered, edge-agnostic.

Building Phase 3's verifier forced this into the open: there is no coherent
way to attach a single `ConfidenceLevel` to a usage proof that means the same
thing it means on a lineage edge, because a usage proof carries no lineage
claim at all — it's a statement about one served response, at one moment.

## Decision
`ConfidenceLevel` (the enum) is reused, not duplicated — same three values,
same ordering, same import — but it is applied along **two independent
axes** that Phase 4 will later combine:

1. **Lineage confidence** (unchanged, `CascadeRegistry`): how strongly a
   parent→child derivation claim is backed. Can be any of the three values.
2. **Serving confidence** (new, `ExecutionRegistry`): how strongly a specific
   `UsageProof` establishes that the model actually served matches its
   registered commitment. For a usage proof specifically:
   - `CryptographicallyBound` — the provider is registered in
     `CascadeWrapper` mode and the proof's claimed model commitment matches
     the model's registered commitment.
   - `Declared` — everything else: a plain signed claim from a registered
     signer, with no serving-time verification behind it.
   - `AttestedTraining` **never appears as a usage proof's serving
     confidence.** It describes how a model came to exist, not what's being
     served this instant — those are orthogonal questions. A model with
     Level 2 (attested-training) provenance can still only produce
     `Declared`-confidence usage proofs unless it's also served through the
     wrapper.

Phase 4's effective trust for a payout is `min(serving confidence of the
triggering usage proof, weakest lineage-edge confidence along the
attribution path)` — not decided in this phase, recorded here so Phase 4
doesn't have to re-derive it.

## Consequences
- `ExecutionRegistry`'s `CascadeWrapper` provider mode is, today, an
  owner-attested flag with **no cryptographic backing** — Phase 7 doesn't
  exist yet. Setting a provider to `CascadeWrapper` mode right now is a
  placeholder that proves the plumbing is correct, not a real security
  claim. This must not be described as "Level 1" anywhere public until
  Phase 7 replaces the owner-attestation with a real wrapper-measurement
  check. See `docs/trust-model.md`.
- `docs/protocol-spec.md` needs a short addendum distinguishing the two axes
  explicitly — added alongside this ADR.
