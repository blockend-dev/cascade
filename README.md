# Cascade

A settlement layer for AI model lineage on 0G. Every served inference that
passes independent verification triggers proportional payment up a public
ancestry graph.

This is not a hackathon mockup and not a general agent/inference
marketplace. It has one job: given that a model was served, and given a
publicly registered ancestry graph, pay the right ancestors the right
amount — and say exactly how strong that guarantee is, per lineage edge,
every time.

**Live**: [cascade-three-iota.vercel.app](https://cascade-three-iota.vercel.app) — deployed on 0G mainnet
(chain 16661), four contracts live, a real model artifact stored via 0G
Storage with its root hash registered on-chain as the model commitment.
Full evidence, addresses, and transaction hashes: [`docs/mainnet-evidence.md`](docs/mainnet-evidence.md).

Start here: [`docs/architecture.md`](docs/architecture.md).

## Status

Phases 0–10 are implemented and tested: `CascadeRegistry` (Phase 1–2),
`ExecutionRegistry` (Phase 3), `AttributionSettlement` (Phase 4), the
relayer (Phase 5 — see [`docs/relayer.md`](docs/relayer.md)),
`TrainingProvenanceRegistry` (Phase 6 — Level 2 attested-training
provenance), the serving wrapper (Phase 7 — Level 1, see
[`wrapper/README.md`](wrapper/README.md)), the TypeScript SDK
(Phase 8, see [`sdk/README.md`](sdk/README.md)), the event indexer
(Phase 9, see [`docs/indexer.md`](docs/indexer.md)), and the model
provenance/verification/attribution explorer frontend (Phase 10, see
[`docs/frontend.md`](docs/frontend.md)). See `docs/architecture.md`
for the full build order and what's implemented so far.

## Layout

| Path | Contains |
|---|---|
| `docs/` | Architecture, threat model, trust model, protocol spec, invariants, ADRs |
| `contracts/` | Solidity protocol contracts (Hardhat) |
| `wrapper/` | Cascade-authored attested serving wrapper (Level 1) |
| `relayer/` | Permissionless usage-proof submission service |
| `sdk/` | TypeScript client (implemented — see `sdk/README.md`) |
| `indexer/` | Read-only event indexer / query projection (implemented — see `docs/indexer.md`) |
| `web/` | Model provenance/verification/attribution explorer (implemented — see `docs/frontend.md`) |
| `tests/` | Cross-component integration tests |
