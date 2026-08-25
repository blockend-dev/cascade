# Cascade

An on-chain settlement layer that turns AI model lineage into enforceable, pull-based attribution — deployed and running on 0G mainnet.

- **Live demo**: [cascade-three-iota.vercel.app](https://cascade-three-iota.vercel.app)
- **0G mainnet**: chain `16661` — four contracts deployed, see [Mainnet deployment](#mainnet-deployment)
- **Repository**: [github.com/blockend-dev/cascade](https://github.com/blockend-dev/cascade)
- **Mainnet evidence**: [docs/mainnet-evidence.md](docs/mainnet-evidence.md) — addresses, transaction hashes, the 0G Storage root hash, and independent verification results

## What is Cascade?

AI models increasingly derive value from other models — through fine-tuning, distillation, routing, and ensembles — but that lineage carries no economic mechanism of its own. A downstream model can be served and paid for while every upstream model it depends on gets nothing.

Cascade turns a public model ancestry graph into an on-chain settlement graph. When a downstream model's usage is represented by an accepted usage proof, attribution propagates through its registered ancestry, and upstream models can claim their proportional share.

Cascade does not prove model derivation on its own. It records lineage claims with an explicit confidence level and settles strictly according to the protocol's rules — a claim is never treated as stronger than the evidence actually backing it.

## Why Cascade?

- **Lineage without enforcement.** Ancestry between models is knowable, but nothing turns "model B was fine-tuned from model A" into an automatic, on-chain payment when B is used.
- **Unequal evidence, equal treatment.** A lineage claim backed by a signed training record and a claim backed by nothing but an assertion are usually presented identically elsewhere. Cascade keeps them distinguishable, on-chain, permanently.
- **No deterministic multi-hop attribution.** When a model has several ancestors across several hops, there's no standard way to propagate a payment through that graph without a central operator deciding by hand.
- **Serving evidence and lineage evidence are different questions.** Whether a model was actually served correctly is not the same claim as whether its lineage is accurate — collapsing the two loses information a payer needs.

## How it works

1. A model owner registers a model and its immutable commitment — a content-addressed reference to the served artifact.
2. A lineage edge (parent → child) is registered with an explicit confidence level and royalty share.
3. Training provenance is recorded where available, strengthening a lineage edge's evidence.
4. A provider produces a signed usage proof for a served request.
5. The usage proof is registered on-chain, replay-protected by a deterministic execution ID.
6. At settlement, attribution walks the bounded ancestry graph from the served model.
7. Effective attribution for each hop uses the protocol's weakest-link confidence — never the strongest claim along the path.
8. Ancestors accumulate a claimable balance and pull their payment whenever they choose.

Full architecture and component diagram: [docs/architecture.md](docs/architecture.md).

## Confidence model

Cascade tracks three confidence levels per lineage edge, using the protocol's exact terminology:

| Level | Name | What backs it |
|---|---|---|
| 1 (strongest) | **Cryptographically Bound** | Served through Cascade's own attested wrapper, which checks the loaded model's hash against its registered commitment before serving, inside a measured TEE launch configuration. |
| 2 | **Attested Training** | Backed by a signed training record (base model, dataset, script) plus a checked output-integrity hash. Circumstantial, accountable evidence — not a proof of derivation. |
| 3 (weakest) | **Declared** | The model owner asserts the relationship. Staked and publicly challengeable; secured economically, not cryptographically. |

Two rules keep this meaningful rather than decorative:

- **Lineage confidence and serving confidence are separate axes.** Lineage confidence describes how a parent→child claim is backed; serving confidence describes how strongly one specific usage proof establishes that what was actually served matches the registered commitment. The two are never merged into a single generic badge.
- **Weakest-link composition.** The effective confidence of any multi-hop attribution path is the minimum confidence along that path — never an average, and never inherited upward from a stronger ancestor.

Full specification: [docs/protocol-spec.md](docs/protocol-spec.md).

## 0G integration

### Live and demonstrated

**0G Chain**
Four Cascade contracts are deployed and executing on 0G mainnet (chain `16661`) — `CascadeRegistry`, `ExecutionRegistry`, `AttributionSettlement`, `TrainingProvenanceRegistry`. All protocol state and settlement logic run on-chain. Addresses and explorer links: [Mainnet deployment](#mainnet-deployment).

**0G Storage**
A real model artifact was uploaded through 0G Storage. The exact root hash 0G Storage returned was registered, unmodified, as the model's on-chain commitment. Retrieval was independently proof-verified, byte-for-byte, against the original artifact. Full evidence — upload transaction, fee paid, root hash, verification result: [docs/mainnet-evidence.md](docs/mainnet-evidence.md).

### Architecturally supported, not currently demonstrated live

**0G Compute / TEE**
Cascade's serving wrapper (`wrapper/`) is built to integrate with attested serving on 0G Compute — checking a model's hash against its registered commitment before serving, inside a measured TEE launch. This is implemented and documented, but this submission does not claim a live 0G Compute/TEE serving demonstration; it has not been exercised against real 0G Compute infrastructure.

## Mainnet deployment

0G Mainnet — chain ID `16661` — explorer: [chainscan.0g.ai](https://chainscan.0g.ai)

| Contract | Address |
|---|---|
| CascadeRegistry | [`0x74F13b00B8e691f5c3794B803b80032Aa268b25b`](https://chainscan.0g.ai/address/0x74F13b00B8e691f5c3794B803b80032Aa268b25b) |
| ExecutionRegistry | [`0x27Ec35689323624f209F5B19b53Ee4d07D77767d`](https://chainscan.0g.ai/address/0x27Ec35689323624f209F5B19b53Ee4d07D77767d) |
| AttributionSettlement | [`0xA5eFE05E7d20B814e3C0B138a518277E876f2647`](https://chainscan.0g.ai/address/0xA5eFE05E7d20B814e3C0B138a518277E876f2647) |
| TrainingProvenanceRegistry | [`0x383D962Bf9fCB34AB4910B9cC54695c52EB7e635`](https://chainscan.0g.ai/address/0x383D962Bf9fCB34AB4910B9cC54695c52EB7e635) |

Deployment record: [`contracts/deployments/target.json`](contracts/deployments/target.json). Full evidence — transaction hashes, the 0G Storage root hash, and independent verification results: [docs/mainnet-evidence.md](docs/mainnet-evidence.md).

## Repository structure

| Directory | Purpose |
|---|---|
| `docs/` | Protocol specification, architecture, security invariants, threat model, trust model, ADRs |
| `contracts/` | On-chain protocol (Solidity, Hardhat) — also holds the cross-component integration tests, under `contracts/test/` |
| `sdk/` | Typed TypeScript client, EIP-712 signing helpers, contract bindings |
| `relayer/` | Permissionless usage-proof submission service |
| `indexer/` | Read-only event indexer and query API |
| `wrapper/` | Cascade-authored attested serving integration |
| `web/` | Model provenance/verification/attribution explorer — the live frontend |

## Getting started

```bash
git clone https://github.com/blockend-dev/cascade.git
cd cascade
```

**Contracts** — compile and run the full protocol test suite locally, against Hardhat's own network:
```bash
cd contracts
npm install
npm run build   # hardhat compile
npm test        # hardhat test
```

**SDK**:
```bash
cd sdk
npm install
npm run build
```

**Indexer** — needs an RPC endpoint and the four contract addresses (see `indexer/.env.example`):
```bash
cd indexer
npm install
npm run build
npm start
```

**Frontend** — needs the matching `VITE_*` variables (see `web/.env.example`):
```bash
cd web
npm install
npm run dev      # or: npm run build && npm run preview
```

**Relayer** and **wrapper** follow the same `npm install` → `npm run build` pattern; see `relayer/README.md` and `wrapper/README.md` for their specific configuration and runtime requirements.

For an actual mainnet deployment, the deployer private key and RPC endpoint are operator-supplied via environment variables and must never be committed — see [docs/deployment.md](docs/deployment.md) for the full procedure and `contracts/.env.example` for what's required.

## Development

Contracts are covered by a Hardhat test suite (195 tests at the time of writing) exercising the four contracts' state transitions, replay protection, challenge/finalization flow, and adversarial cases. Each other package (`sdk`, `relayer`, `wrapper`, `indexer`, `web`) carries its own build and, where applicable, test step. CI (`.github/workflows/ci.yml`) installs and builds every package in dependency order and runs the full contracts suite on every push.

## Security and trust model

This repository documents, and is intentionally structured around, the difference between what the protocol enforces on-chain, what is attested by a signed off-chain record, and what is merely declared by an untrusted party:

- [docs/security-invariants.md](docs/security-invariants.md) — numbered invariants, each tied to enforcing code or explicitly marked as an economic (not cryptographic) property
- [docs/threat-model.md](docs/threat-model.md) — enumerated attacks and how each is mitigated or explicitly accepted as residual risk
- [docs/trust-model.md](docs/trust-model.md) — what every component and confidence level is, and is not, trusted for
- [docs/protocol-spec.md](docs/protocol-spec.md) — the exact data model and settlement rules

## Mainnet evidence

[docs/mainnet-evidence.md](docs/mainnet-evidence.md) records the actual mainnet state, not an aspirational one: deployed contract addresses, the 0G Storage upload transaction and fee paid, the returned root hash, the on-chain model registration transaction, and the results of independently re-verifying the download and the on-chain commitment afterward.

## Roadmap — future work

Not yet built; listed for direction, not as a commitment:

1. A live 0G Compute/TEE provider integration, exercised against real 0G Compute infrastructure rather than only implemented.
2. Connecting that serving attestation into the existing lineage/settlement model as an on-chain-verifiable Level 1 signal.
3. Expanding integrations for additional model providers and marketplaces.
4. Continued hardening of the protocol and its operational tooling.

