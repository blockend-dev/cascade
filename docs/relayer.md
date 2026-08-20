# Cascade — Relayer (Phase 5)

**The relayer is a liveness component, not a source of truth.** Every
claim in this document exists to make that sentence checkable, not just
assertable — see `contracts/test/relayer/` for the tests that back each
one.

## Role and trust boundary

The relayer sits between signed usage evidence and `AttributionSettlement`:

```
0G TEE execution
      ↓
signed UsageProof (signed by a Cascade-registered provider signer,
                    not by the relayer)
      ↓
RELAYER — verifies, submits, retries
      ↓
AttributionSettlement.settleExecution
      ↓
ancestor attribution (recipient, amount, model — all contract-derived)
```

The relayer never signs a `UsageProof` and never constructs one from
scratch. It only ever relays evidence someone else (a provider, or its
enclave) already signed.

It is **not trusted** for: provider identity, model identity, request
hash, response hash, execution identity, recipient, royalty amount,
lineage, confidence, settlement eligibility, or payment calculation.
Every one of these is either recovered cryptographically or read from
contract state — see `relayer/src/types.ts`'s `VerifiedUsage`, none of
whose fields are ever echoed from caller-supplied input.

It **is** trusted for exactly one thing: whether it bothers to submit at
all. If every relayer instance disappears, attribution is delayed —
nothing more. Funds cannot be stolen, attribution cannot be redirected,
and fabricated usage cannot become valid, because none of those properties
were ever the relayer's to grant.

### The five properties, kept separate (per `docs/trust-model.md`)

- **Safety** — the relayer cannot fabricate or redirect valid attribution.
  Recipients and amounts are always contract-derived (`CascadeRegistry`
  ownership state, `AttributionSettlement.attributionFeePerExecution`) —
  see `contracts/test/relayer/multiRelayer.test.ts`'s "neither relayer can
  redirect the recipient" test.
- **Liveness** — the relayer can delay settlement by refusing or failing
  to submit. It cannot prevent settlement permanently: any other party
  holding the same signed evidence can submit instead.
- **Provenance** — the relayer does not establish lineage. It never calls
  `CascadeRegistry.registerLineageEdge` and has no code path that could.
- **Execution integrity** — established entirely by the verified
  cryptographic evidence (§Verification strategy below), not by the
  relayer's say-so.
- **Model identity** — depends on the confidence level `ExecutionRegistry`
  already established for the proof (ADR 0006). The relayer never
  upgrades or downgrades it; `servingConfidence` is read straight through
  from `VerifiedUsage`.

## Verification strategy (ADR 0009)

Two tiers:

1. **Local structural pre-filter** (`relayer/src/verifier.ts:validateStructure`)
   — no RPC. Rejects malformed JSON shape, wrong-length hex, out-of-range
   integers. Exists purely to avoid spending a network round-trip on
   garbage; makes no cryptographic claim.
2. **On-chain simulation** — `ExecutionRegistry.verifyUsageProof.staticCall(...)`,
   a free, state-non-mutating call into the *actual deployed contract's*
   logic. This is not a reimplementation of the contract's checks; it is
   the contract's checks, run early and for free. See ADR 0009 for why
   this was chosen over reproducing the EIP-712/ECDSA/commitment logic in
   TypeScript.

At submission time, a further full dry-run —
`AttributionSettlement.settleExecution.staticCall(...)` with the exact
funding value — catches anything that changed since verification
(a race lost to another relayer, an epoch that advanced) before a real
transaction is sent.

## Idempotency

Local state (`relayer/src/executionStore.ts`) is a pure optimization. On
restart it is empty, and that is correct by design: every `executionId`
is re-checked against `ExecutionRegistry.executionConsumed` before any
action is taken, regardless of what the local process remembers. See
`contracts/test/relayer/relayer.test.ts`'s restart test — a fresh relayer
instance with zero local memory correctly detects an already-settled
execution purely from chain state.

`executionId` is never relayer-chosen. It's `ExecutionRegistry`'s own
deterministic derivation (`hash(provider, modelId, requestHash,
responseHash)`, Phase 3) — the relayer reads it out of the verified
`VerifiedUsage`, never computes a competing one. See ADR 0009 and
`docs/security-invariants.md` INV-20 ("single notion of execution
identity").

## Multi-relayer safety

Any number of independent relayer processes may observe and submit the
same proof. Exactly one settlement transaction can succeed —
`ExecutionRegistry`'s own replay protection (Phase 3) guarantees this, not
anything the relayer does. A losing relayer's transaction reverts with
`ExecutionAlreadyConsumed`; the submitter classifies this specific revert
as a **duplicate**, not a failure, and does not retry it. See
`contracts/test/relayer/multiRelayer.test.ts` — two and three-way races,
and an explicit check that the economic outcome (recipient, amount) is
identical no matter which relayer wins or how the race is timed.

## Transaction lifecycle

States: `DISCOVERED → VERIFIED → SUBMITTING → PENDING → CONFIRMED
(→ SETTLED) | DUPLICATE | INVALID | RETRYABLE_FAILURE | PERMANENT_FAILURE`
(`relayer/src/types.ts:ProofStatus`).

- **Confirmations**: configurable (`CONFIRMATIONS`, default 1). This
  repository targets a Hardhat-local / 0G-chain deployment; the
  documented assumption is that this project does not require the
  many-confirmation finality assumptions of a probabilistic-finality
  chain like pre-merge Ethereum. If deployed against a chain with weaker
  finality guarantees, raise `CONFIRMATIONS` accordingly — this is a
  config value specifically so that decision doesn't require a code
  change.
- **Nonce management**: one relayer *process* serializes all its
  submissions through a single queue (`relayer/src/submitter.ts`) and
  captures its nonce once per settlement, reusing it across retries as a
  genuine fee-bump replacement rather than queuing a second, competing
  transaction. This is a deliberate simplification — see ADR 0009's
  sibling reasoning: parallelism and redundancy come from running
  multiple independent relayer processes (each its own key), not from
  concurrency inside one process. That's also exactly the multi-relayer
  scenario Phase 5 asks to be tested, so the simplification and the test
  coverage line up.
- **Retries**: bounded exponential backoff with jitter
  (`relayer/src/retry.ts`), capped by `MAX_SUBMISSION_ATTEMPTS`. Each
  retry bumps `maxFeePerGas`/`maxPriorityFeePerGas` by
  `GAS_BUMP_PER_ATTEMPT` — a real fee-bump replacement, not a blind resend.
- **Failure classification** (`relayer/src/submitter.ts:classifyError`):
  `duplicate` (matches `ExecutionAlreadyConsumed` — success, stop),
  `permanent` (matches a known invalid-proof error — stop, never retry),
  `transient` (anything else — RPC timeouts, dropped transactions,
  temporary gas-estimation failures — retry with backoff).

## Source of usage proofs

`UsageProofSource` (`relayer/src/types.ts`) is deliberately narrow: a
`start`/`stop` pair. The first implementation
(`relayer/src/ingestion.ts:HttpUsageProofSource`) is a single `POST
/proofs` HTTP endpoint with a bounded body size and no framework
dependency. Phase 9's indexer is not built here — swapping in a queue,
file, or poll-based source later means implementing the same interface;
nothing about verification or submission changes.

## Key management

No private key is hardcoded or committed (`relayer/.env.example`
documents the variable, empty by default). `relayer/src/signer.ts` is the
abstraction boundary: it returns a plain `ethers.Signer`, and everything
downstream depends only on that interface. A KMS/HSM-backed signer plugs
in by changing `createSigner`'s implementation — nothing else in the
relayer needs to change. No such infrastructure exists elsewhere in this
repository yet, so it isn't built here; this is the documented seam for
it.

## Observability

Structured JSON logs (`relayer/src/logger.ts`) with an allow-list
redaction policy — private keys, signatures, and secrets are never logged,
by construction (blocked by field name, not by remembering to omit them
at each call site). Six counters (`relayer/src/metrics.ts`): proofs
received/rejected/settled/duplicate, transaction failures, retries. No
exporter or metrics backend is wired up — `snapshot()` is there for a
production deployment to scrape into whatever it already uses; see ADR
discussion in this doc's intro for why a bigger stack wasn't introduced.

## Required configuration

See `relayer/.env.example` for the authoritative list: `RPC_URL`,
`CHAIN_ID`, the three deployed Cascade contract addresses,
`RELAYER_PRIVATE_KEY` (dev only), `HTTP_PORT`, `CONFIRMATIONS`,
`CONFIRMATION_TIMEOUT_MS`, `MAX_SUBMISSION_ATTEMPTS`,
`RETRY_BASE_DELAY_MS`, `RETRY_MAX_DELAY_MS`, `GAS_BUMP_PER_ATTEMPT`.

## What Phase 5 deliberately does not build

- Phase 9's indexer or any DAG-resolution logic — the relayer relays
  already-signed proofs; it does not compute attribution.
- A distributed queue or coordination layer between relayer instances —
  they don't coordinate; on-chain replay protection is what makes that
  safe (§Multi-relayer safety).
- HSM/KMS integration — the abstraction boundary exists (§Key management);
  the integration itself does not, because no such infrastructure exists
  elsewhere in this repository to integrate with yet.
- A local signature-recovery/crypto reimplementation — deliberately
  avoided; see ADR 0009.
