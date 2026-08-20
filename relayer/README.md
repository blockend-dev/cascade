# relayer

Phase 5. Permissionless usage-proof submission service — **liveness and
convenience only, never a source of truth**. See
[`docs/relayer.md`](../docs/relayer.md) for the full trust-boundary
writeup; this file is setup/operational only.

## Run

```
npm install
cp .env.example .env   # fill in RPC_URL, contract addresses, RELAYER_PRIVATE_KEY (dev only)
npm run dev
```

`POST /proofs` with a JSON body `{ "proof": {...}, "signature": "0x..." }`
matching `ExecutionRegistry.UsageProof`'s fields.

## Required configuration

See [`.env.example`](.env.example) for the full list. In short: an RPC
endpoint and chain id, the three deployed Cascade contract addresses, and
a signer (a raw key for development; see
[`src/signer.ts`](src/signer.ts) for the abstraction boundary production
should use instead).

## Structure

| Module | Responsibility |
|---|---|
| `verifier.ts` | Structural pre-filter + on-chain simulation-based verification. Never trusts a caller's claim about validity. |
| `submitter.ts` | Transaction lifecycle: dry-run, submit, confirm, fee-bump retry, race/duplicate classification. Serializes submissions per process. |
| `executionStore.ts` | Local, in-memory, restart-unsafe-by-design bookkeeping — an optimization, never an authority. |
| `ingestion.ts` | `UsageProofSource` — the first implementation is a plain HTTP endpoint. |
| `relayer.ts` | Wires the above together. |
| `signer.ts` | Abstraction boundary for the transaction-signing key. |
| `config.ts` | Environment-driven configuration, no hardcoded secrets. |
| `logger.ts` / `metrics.ts` | The entire observability stack Phase 5 needs — see `docs/relayer.md`. |

Tests live in `contracts/test/relayer/` — they exercise this package's
modules against the real deployed contracts on Hardhat's local network,
not mocks, so multi-relayer races and replay behavior are tested against
actual chain state.
