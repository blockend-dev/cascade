# Cascade — Architecture

## What Cascade is

Cascade is a settlement layer for AI model lineage on 0G. Every served inference
that passes independent verification triggers proportional payment up a public
ancestry graph.

It is not a model marketplace, not an agent identity system, and not a general
inference router. Those already exist elsewhere, including natively on 0G
(ERC-8004 identity/reputation, the Compute Network's own provider marketplace).
Cascade's job is narrower: given that a model was served, and given a publicly
registered ancestry graph for that model, pay the right ancestors the right
amount, and make the strength of that guarantee explicit rather than uniform.

## Why three confidence levels, not one

0G's attestation surface proves different things depending on how a model came
to exist and how it's served. Collapsing that into a single "verified" flag
would silently overstate the weakest case. Cascade instead defines three
levels per lineage edge:

| Level | Name | What backs it |
|---|---|---|
| 1 | Cryptographically bound | Served through the Cascade-authored attested wrapper, which verifies the loaded model's hash against the registered commitment before serving, inside a measured TEE launch configuration. |
| 2 | Attested training provenance | Produced via 0G's fine-tuning service: signed declared inputs (base model, dataset, script hashes) plus a checked output-file integrity hash. Circumstantial and accountable, not a strict cryptographic proof of derivation. |
| 3 | Declared | The model owner asserts ancestry. Staked, publicly visible, and challengeable. Economic security only. |

See `docs/adr/0001-three-confidence-levels.md` for why this replaced the
earlier two-tier design, and `docs/trust-model.md` for exactly what's
cryptographically guaranteed at each level versus merely economically
disincentivized.

**Confidence is per edge, never per DAG.** A→B→C→D can have three different
confidence levels on three different edges. The effective confidence of any
derived path is its weakest edge, never an average, and never inherited
upward from a stronger ancestor. See `docs/protocol-spec.md` for the exact
resolution rule.

## System components

```
                    MODEL REGISTRATION
                          │
              ┌───────────┴───────────┐
              │                       │
        CascadeRegistry         (Level 2 / Level 1
        (Phase 1–2)              evidence attached
              │                  to an edge as it's
              │                  registered)
              ▼
        Challenge window
        (inside CascadeRegistry)
              │
              ▼
        Finalized lineage edge
              │
              ▼
   0G ATTESTED INFERENCE (existing 0G Compute Network —
   registered provider, registered TEE signer, signed
   request/response binding)
              │
              ▼
   VERIFIABLE EXECUTION EVIDENCE
   (anyone can independently recheck the signature —
   this is the "usage proof", Phase 3)
              │
              ▼
        Relayer (Phase 5) — permissionless, liveness-only,
        submits usage proofs; cannot fabricate, redirect,
        or determine attribution
              │
              ▼
        AttributionSettlement (Phase 4)
        off-chain DAG resolution → compact on-chain
        verification → epoch-batched pull-payment claims
              │
              ▼
        Ancestors claim their balance
```

## What Cascade explicitly does not depend on

- **0G's Compute/Serving settlement contract internals.** Source was not
  publicly located across three research passes (see `docs/adr/0003`).
  Cascade's settlement is a parallel system, not an integration.
- **0G's fine-tuning attestation being a proof of training.** It isn't, on
  current public evidence. Level 2 is worded as circumstantial evidence, not
  proof, everywhere in this codebase and its documentation.
- **A trusted relayer.** The relayer submits; the contract verifies. See
  `docs/trust-model.md`.
- **ERC-7857.** Model ownership is a plain address in the core protocol.
  ERC-7857 may become an optional adapter later; it is not a dependency.

## Build order

Phase 0 (this commit set) — architecture lock: this document, the threat
model, the trust model, the protocol spec, the security invariants, and the
ADRs recording the decisions the prior research left open.

Phases 1–10 follow the order in `docs/adr/0002-repo-layout-and-tooling.md`.
This repository currently implements through Phase 8:
`CascadeRegistry` (Phase 1–2), `ExecutionRegistry` (Phase 3),
`AttributionSettlement` (Phase 4), the relayer (Phase 5, see
`docs/relayer.md`), `TrainingProvenanceRegistry` (Phase 6, see
`docs/protocol-spec.md` §7 and ADR 0010), the serving wrapper
(Phase 7, see `docs/protocol-spec.md` §8 and ADR 0011), and the
TypeScript SDK (Phase 8, see `sdk/README.md` and ADR 0012). Later
phases are scaffolded with a README describing their contract, not
implemented yet.

## Repository layout

```
contracts/   Solidity protocol contracts (Hardhat project)
wrapper/     Phase 7 — Cascade-authored attested serving wrapper (implemented — see wrapper/README.md)
relayer/     Phase 5 — permissionless usage-proof submission service (implemented — see docs/relayer.md)
sdk/         Phase 8 — TypeScript client for registration, proofs, claims (implemented — see sdk/README.md)
indexer/     Phase 9 — off-chain DAG resolution / settlement builder
web/         Phase 10 — minimal demonstration frontend
tests/       cross-component integration tests (contracts keep their own
             unit/fuzz tests colocated under contracts/test, per Hardhat
             convention — see ADR 0002)
docs/        this document and everything referenced from it
```
