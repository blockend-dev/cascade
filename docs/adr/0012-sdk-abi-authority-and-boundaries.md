# ADR 0012 — SDK consumes generated ABIs, not hand-maintained fragments; explicit boundaries with relayer/wrapper

## Status
Accepted

## Context — the bug that motivated this

Phase 7 found a real bug: `CascadeRegistry.getModel` returns a single
`Model memory` struct (one ABI tuple), but both `relayer/src/abi.ts` and
`wrapper/src/abi.ts` had hand-written it as five flat return values — a
different wire encoding that type-checks in TypeScript but fails to
decode at runtime. It was only caught because a test happened to exercise
that exact call path. Hand-maintained ABI fragments are a real, proven
source of silent drift between what a contract actually does and what
client code assumes it does.

## Decision — generated ABIs

`sdk/scripts/generate-abis.ts` reads the compiled artifact JSON Hardhat
already produces (`contracts/artifacts/src/<Name>.sol/<Name>.json`) and
writes `sdk/src/abis/<Name>.ts` — the `abi` field, verbatim, with no
hand-editing. Regenerate with `npm run generate-abis` after any contract
change; the generated files are committed (so the SDK doesn't require a
contracts/ compile step to install or use) but are never hand-edited —
the header comment on each generated file says so, and says how to
regenerate.

This is additive only: `contracts/`, `relayer/`, and `wrapper/` are
unmodified. `relayer/src/abi.ts` and `wrapper/src/abi.ts` keep their
existing (now-fixed) hand-maintained fragments rather than being migrated
to depend on the SDK — retrofitting them is reasonable future cleanup,
not required by this phase, and doing it now would add a new
relayer→sdk / wrapper→sdk dependency edge for no benefit this phase
actually needs.

## Decision — what the SDK wraps versus what it locally defines

Per the phase brief, the SDK must wrap existing logic, not reimplement
it. Applied concretely:

- **EIP-712 verification**: the SDK does not reimplement digest
  computation for the purpose of *verifying* a proof or claim — it calls
  `ExecutionRegistry.verifyUsageProof` / `TrainingProvenanceRegistry.hashTypedDataDigest`
  the same way `relayer/src/verifier.ts` does (ADR 0009's precedent,
  reused here, not re-derived).
- **EIP-712 signing** is the one place the SDK necessarily defines
  domain/type structures locally (`sdk/src/eip712.ts`) — there is no way
  to ask a contract to sign on a caller's behalf; constructing a
  signature is inherently a client-side operation. These structures are
  copied field-for-field from `ExecutionRegistry.USAGE_PROOF_TYPEHASH`
  and `TrainingProvenanceRegistry.TRAINING_PROVENANCE_CLAIM_TYPEHASH`
  (confirmed from the generated ABI + contract source, not assumed), and
  a dedicated test cross-checks that the SDK's locally-computed digest
  matches the contract's own `hashTypedDataDigest` output, byte for byte
  — the same discipline Phase 3 established for exactly this failure
  mode.
- **Execution identity, confidence composition, settlement arithmetic,
  lineage traversal, provenance cross-checks, storage proof
  verification**: none of these are reimplemented anywhere in the SDK.
  Every SDK function that touches them is a thin wrapper around the
  corresponding contract call — `hashExecutionId`, `pathConfidence`,
  `settleExecution`, `getParentEdgeIds`, `matchesEdge`, and (for storage)
  nothing at all, since 0G Storage proof verification lives in
  `wrapper/src/storage.ts` via the SDK the wrapper already depends on
  directly, not duplicated here.

## Decision — `UsageProof` and `TrainingProvenanceClaim` are declared three times, and that's a type-declaration fact, not a protocol fact

`relayer/src/types.ts`, `wrapper/src/types.ts`, and now `sdk/src/types.ts`
each declare a structurally-identical `UsageProof` interface (same
fields, same order). This is *not* a second execution identity or a
second protocol representation — there is exactly one `executionId`
derivation (`ExecutionRegistry.hashExecutionId`), computed in exactly one
place (the contract), and every package calls it the same way. What's
duplicated is a TypeScript structural type — an ergonomics artifact of
three independently-runnable packages, not a semantic fork. Unifying it
into one shared `@cascade/types` package was considered and rejected as
scope creep for this phase: it would mean touching `relayer/` and
`wrapper/` (their own `import` statements) for a purely cosmetic
de-duplication, contradicting "no changes to completed phases unless
strictly necessary."

## Decision — the SDK's `submitUsageProof` is single-shot, not the canonical submission path

The phase brief is explicit: the Phase 5 relayer remains canonical for
submission. The SDK's usage-submission helper is a thin, single-attempt
wrapper around `AttributionSettlement.settleExecution` — no retry, no
backoff, no fee-bump replacement, no multi-relayer race handling. It
exists for read-only integrators, tests, and simple scripts; its own
doc comment says, in those words, "for production submission robustness
use the relayer, not this."

## Consequences

- Zero changes to `contracts/`, `relayer/`, or `wrapper/`.
- A future contract change that alters an ABI-affecting signature is
  caught by regenerating and recompiling against the SDK's own tests
  (`sdk` tests import the generated ABI directly), not by a second
  hand-maintained fragment silently going stale.
- `relayer/src/abi.ts` and `wrapper/src/abi.ts` remain a *known*,
  disclosed duplication of ABI authority, now doubly justified: this ADR
  and ADR 0005's original reasoning both stand, and both packages'
  existing tests already exercise their fragments correctly (the one bug
  found was fixed in Phase 7, not re-introduced here).
