# Cascade — 0G Mainnet Evidence

Real, verified evidence from actual mainnet execution — no simulated or
testnet data. Every value below was independently read back on-chain
after the fact, not merely asserted from a submitted transaction. See
`docs/deployment.md` for the deployment procedure and
`wrapper/scripts/` for the exact commands that produced this.

## Deployed contracts (0G mainnet, chain 16661)

| Contract | Address |
|---|---|
| CascadeRegistry | `0x74F13b00B8e691f5c3794B803b80032Aa268b25b` |
| ExecutionRegistry | `0x27Ec35689323624f209F5B19b53Ee4d07D77767d` |
| AttributionSettlement | `0xA5eFE05E7d20B814e3C0B138a518277E876f2647` |
| TrainingProvenanceRegistry | `0x383D962Bf9fCB34AB4910B9cC54695c52EB7e635` |

Explorer: `https://chainscan.0g.ai/address/<address>` for each of the above.
Deployment record: `contracts/deployments/target.json`.

## 0G Storage integration — real upload/download round trip

- **Artifact**: `wrapper/demo-artifact/cascade-demo-model.safetensors` — a
  real, spec-valid [safetensors](https://github.com/huggingface/safetensors)
  file (384 bytes) containing an actual trivial linear model's parameters
  (a 2×2 F32 weight matrix + a 2-element F32 bias vector). Generated
  deterministically by `wrapper/scripts/generate-demo-artifact.ts` — fixed
  literal values, not random, so re-running it reproduces the identical
  file byte-for-byte. SHA256: `8d1e76e46a86f51cd32c7dddfc5713104e607fa32420bc25419cf8e6c737706e`.
- **Upload**: real `@0gfoundation/0g-storage-ts-sdk@1.2.11` `Indexer.upload()`
  call against `https://indexer-storage-turbo.0g.ai` (0G mainnet's storage
  indexer, confirmed directly against `docs.0g.ai`'s Mainnet Overview page
  — corrects a stale value previously in `wrapper/.env.example`).
  - **Root hash**: `0x064b328dcf0a688243dc9e905c5bb72be6623a348e82c2c3df7df368489b4cdf`
    — identical to the value computed **locally and offline**
    (`ZgFile.merkleTree()`) before any network call, confirming the
    upload didn't alter or misrepresent the content.
  - **Storage transaction hash**: `0x9e333681fb649229151fe6736c23ede44eeb9dc629fb09e1cdc034d12474a3a8`
  - **Storage transaction sequence**: `205676`
  - **Fee paid** (read live from 0G Storage's own Market contract via
    `pricePerSector()` — never hardcoded or guessed): `61467289924` wei
    (≈0.0000000615 0G)
  - **Total spent** (fee + gas, measured by balance delta): `0.001225825469435011` 0G
- **Download + proof verification**: performed through the **existing
  production code path** — `wrapper/src/storage.ts`'s `ZgStorageClient.downloadVerified()`,
  the same class the wrapper itself uses at runtime, not a separate
  one-off implementation. Result: **OK**, real Merkle-proof verification
  passed against 3 independently-discovered live storage nodes.
  Downloaded file SHA256 matched the original exactly:
  `8d1e76e46a86f51cd32c7dddfc5713104e607fa32420bc25419cf8e6c737706e` —
  byte-for-byte identical, confirmed programmatically
  (`wrapper/scripts/verify-download.ts`), not eyeballed.
- Storage explorer (not independently verified in this session, but the
  official 0G Storage explorer per `docs.0g.ai`): `https://storagescan.0g.ai/`

## Model registration on CascadeRegistry (mainnet)

- **Signer**: `0x360A632F7F51a31EBbcDe2DEcb526b750DE3D803` — a wallet
  generated specifically for this demo, **never the deployer/owner/resolver
  key**. Funded with 0.05 0G from the deployer wallet (funding tx:
  `0x0081329b4d4829f7795581c4238344d314a600638adb2fd1c2cc829ca0ee25ef`,
  block 42522433). This wallet became the model's owner — an ordinary,
  unprivileged registration, not a provider/relayer role.
- **Call**: `sdk`'s `createCascadeClient(...).write.registerModel(rootHash, metadataURI)`
  — the exact returned Storage root hash passed straight through as
  `modelCommitment`, no transformation, no invented value.
- **modelId**: `0xf426fbad44ca2774046cbb5e13d4ba5276f337473be9a35d1d14e2c1c2400ae6`
- **Registration transaction hash**: `0x6757aeed04f5329a78c69012c064548e956b3ad7239616ea6d0cbd364e700f01`
- **Block number**: `42522789`
- **metadataURI**: `0g-storage://0x064b328dcf0a688243dc9e905c5bb72be6623a348e82c2c3df7df368489b4cdf`
- **Independent read-back verification** (a fresh `client.read.getModel(modelId)`
  call, not just trusting the write succeeded):
  - `owner === 0x360A632F7F51a31EBbcDe2DEcb526b750DE3D803` ✓
  - `modelCommitment === <the uploaded rootHash>`, exactly, confirmed programmatically ✓
  - `status === Active` ✓
  - Confirmed on chain ID `16661` ✓

Explorer: `https://chainscan.0g.ai/tx/0x6757aeed04f5329a78c69012c064548e956b3ad7239616ea6d0cbd364e700f01`

## Indexer, synced against real mainnet

- `START_BLOCK=42518150` (conservative — a safety margin before the
  actual deployment block, not the exact block; see
  `contracts/scripts/deploy.ts`'s block-recording fix for why an exact
  value wasn't available when this was first set).
- A fresh indexer instance, synced from that block against real
  `https://evmrpc.0g.ai`, correctly ingested exactly one `ModelRegistered`
  event and projected it — confirmed via `indexer/scripts/verify-mainnet-sync.ts`.
- The **same `IndexerClient` class `web/`'s React pages import**
  (`web/src/api/indexerClient.ts`), queried over a real running instance
  of the indexer's own HTTP server (ADR 0014), returned the correct
  model, an accurate `listModels()` page, and a real `getSyncStatus()`
  reading — confirmed via `indexer/scripts/verify-frontend-datalayer.ts`.
  This is the actual data layer the frontend's Model Explorer / Model
  Detail pages depend on, exercised end to end against mainnet.
- **Deployed durably on Railway** (`indexer/Dockerfile`), running
  continuously and independently of any developer machine — not a
  one-off verification run. Public HTTP endpoint:
  `https://cascade-indexer-production-508a.up.railway.app`. Verified with
  the same cross-origin request the live frontend actually makes
  (`Origin: https://cascade-three-iota.vercel.app`), confirming both a
  correct `access-control-allow-origin` response and real mainnet data
  returned. Storage is currently ephemeral (ties to a container
  filesystem rather than an attached volume), so a redeploy resyncs from
  `START_BLOCK` rather than resuming — a cost in sync time only, since
  the indexer is a rebuildable projection and never a protocol authority
  (`docs/indexer.md`).

## What this evidence does NOT claim

- **No Level 1 / Cryptographically Bound serving claim.** This model has
  no registered lineage edge, no usage proof, and no provider running in
  Cascade Wrapper mode. 0G Storage integration proves **content-addressed
  artifact integrity** — that the registered `modelCommitment` really is
  retrievable, real, and provably unmodified. It does not prove, and this
  document does not claim, anything about TEE attestation, 0G Compute
  Network serving, or cryptographically bound execution. Lineage
  confidence, serving confidence, and effective confidence remain the
  three separate, unmerged concepts they always were (`docs/trust-model.md`).
- **No live 0G Compute/TEE demonstration** — `wrapper/`'s attested-serving
  integration is implemented architecturally but has not been exercised
  against real 0G Compute infrastructure.
- The frontend is deployed and live at
  `https://cascade-three-iota.vercel.app`, reading the indexer above over
  real HTTP — this supersedes an earlier note in this document about
  being unable to produce a rendered screenshot from this development
  environment's own UNC-path limitation; that limitation was about this
  machine, not about whether a real deployment exists.
