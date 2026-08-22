# wrapper

Phase 7. The Cascade-authored attested serving wrapper — the only path to
Level 1 (`CryptographicallyBound`) confidence. See
[`docs/adr/0011-wrapper-feasibility-and-architecture.md`](../docs/adr/0011-wrapper-feasibility-and-architecture.md)
for the primary-source-confirmed feasibility finding and full architecture,
and [`MEASUREMENT.md`](MEASUREMENT.md) for the reproducible-build and
verification runbook.

## What it does

Reads the registered `modelCommitment` for a configured `MODEL_ID` from
`CascadeRegistry` (never a separately-configurable value — there is
nothing to misconfigure into a mismatch), downloads exactly that
content-addressed hash from 0G Storage with Merkle-proof verification on,
and only starts serving an OpenAI-compatible HTTP endpoint if that
succeeds. Any failure — model not found, not active, download/proof
verification failed, backend load failed — exits without ever starting
the server. No runtime model switching, no mutable aliases, no partial or
degraded-mode serving path.

## Run

```
npm install
cp .env.example .env   # fill in RPC_URL, CascadeRegistry address, MODEL_ID, storage indexer URL
npm run dev
```

`POST /v1/chat/completions` once startup logs `server_started`.

## Structure

| Module | Responsibility |
|---|---|
| `lifecycle.ts` | The verify-then-load sequence — the actual security property this package exists to guarantee. |
| `storage.ts` | Wraps `@0gfoundation/0g-storage-ts-sdk`'s `Indexer.download(rootHash, path, proof: true)`. Does not reimplement 0G Storage's Merkle verification — see its header comment for why. |
| `modelBackend.ts` | Reference/stub inference backend. Swap for a real engine (vLLM, TGI, etc.) in production — see its header comment for the integration seam. |
| `server.ts` | Minimal OpenAI-compatible HTTP surface. Only ever started after a verified load. |
| `abi.ts` / `config.ts` | Same patterns as `relayer/`'s equivalents. |

Tests live in `contracts/test/wrapper/` — `lifecycle.test.ts` runs against
a real deployed `CascadeRegistry` on Hardhat's network (not a hand-rolled
mock of it), with a fake `StorageClient`/`ModelBackend` standing in for
0G Storage and a real inference engine, neither of which this environment
can reach. `server.test.ts` covers the HTTP surface directly.

## What this package does not do

- Reimplement 0G Storage's Merkle/chunk hashing — relies entirely on the
  SDK's own `proof: true` verification.
- Reimplement TEE attestation or signing — that's 0G's own Inference
  Broker's job, per the confirmed provider architecture (ADR 0011); this
  wrapper only needs to be the thing the broker wraps.
- Run a real inference engine — `modelBackend.ts` is a documented
  integration seam, not a production backend.
- Modify any existing Cascade contract — `ExecutionRegistry.setProviderMode`
  is unchanged; see ADR 0011 for what this package actually strengthens
  instead.
