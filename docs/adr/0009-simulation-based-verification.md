# ADR 0009 — The relayer verifies by simulating the contract, not by reimplementing its cryptography

## Status
Accepted

## Context
Phase 5's brief asks the relayer to "independently reproduce the
verification performed by the contracts." The obvious reading is: recover
the EIP-712 signer locally, re-derive `executionId` locally, re-check the
model commitment locally, matching `ExecutionRegistry._verify` field for
field in TypeScript. That approach has a real, ongoing cost: every one of
those checks would need to be kept in exact lockstep with the Solidity
implementation forever, and any future change to `ExecutionRegistry`
(a new check, a changed encoding) silently desynchronizes the two unless
someone remembers to update both places — precisely the "TS/Solidity
encoding cross-check" class of bug Phase 3 already worried about.

## Decision
The relayer's `Verifier` does not reimplement ECDSA recovery, the
model-commitment check, or `executionId` derivation. It calls
`ExecutionRegistry.verifyUsageProof` and (at submission time)
`AttributionSettlement.settleExecution` via `staticCall` — free,
state-non-mutating simulations of the real on-chain logic. A cheap local
structural pre-filter (hex-length/type/range checks) runs first, purely to
avoid spending an RPC round-trip on obviously malformed input; it makes no
cryptographic claim of its own.

This satisfies "relayer verifies for efficiency, contract verifies for
authority" more strongly than a reimplementation would: the "off-chain"
verification step *is* the contract's authoritative logic, executed
early and for free, not a second implementation that could quietly drift
from it.

## Consequences
- Every verification-relevant change to `ExecutionRegistry` or
  `AttributionSettlement` is automatically picked up by the relayer with
  no corresponding relayer change required — there is nothing to keep in
  sync.
- The relayer requires RPC access for every verification, including ones
  that would otherwise be cheap pure-function checks (e.g. `executionId`
  derivation). Accepted: these are `eth_call`s, not transactions — no gas,
  and materially cheaper than the alternative of maintaining a second,
  independently-audited cryptographic implementation in TypeScript for a
  Phase 5 service.
- If `ExecutionRegistry`'s interface ever changes incompatibly, the
  relayer's ABI fragments (`relayer/src/abi.ts`, hand-maintained,
  deliberately not code-generated — see that file's own header comment)
  must be updated. This coupling is disclosed, not hidden.
