# ADR 0005 — Provider/signer registration and usage-proof verification live in a new ExecutionRegistry, not CascadeRegistry

## Status
Accepted

## Context
Phase 3 needs a way to establish, on-chain, that a `UsageProof` was signed by
a signer belonging to a registered provider — without trusting a relayer's
claim about who the provider is. `CascadeRegistry` has no concept of
providers or signers today; it only knows about models and lineage edges.

Provider/signer identity and usage-proof verification are a genuinely
different concern from model/lineage state: a provider is an infrastructure
operator, not a model, and doesn't own or transfer models. Folding this into
`CascadeRegistry` would repeat the mistake ADR 0004 deliberately avoided in
the other direction — bolting unrelated state onto a contract for the sake
of having one fewer file, this time state that doesn't share any invariant
with lineage edges at all.

## Decision
A new contract, `ExecutionRegistry`, owns:
- signer → provider registration (a provider may register multiple signer
  addresses; each resolves back to exactly one provider),
- provider serving-mode (`Standard` vs `CascadeWrapper` — see ADR 0006),
- `UsageProof` EIP-712 verification,
- replay-protection state (`executionId → consumed`).

`ExecutionRegistry` holds an immutable reference to a deployed
`CascadeRegistry` and reads from it (`getModel`) to cross-check a proof's
claimed model commitment. The dependency is one-directional —
`CascadeRegistry` has no knowledge of `ExecutionRegistry` and never will,
keeping Phase 1–2 untouched and this phase's blast radius contained to new
files.

## Consequences
- Two registries to deploy and wire together (pass `CascadeRegistry`'s
  address into `ExecutionRegistry`'s constructor) rather than one.
- `CascadeRegistry.sol` required zero changes for Phase 3 — confirmed by
  running the existing 21 tests unmodified after this contract was added.
- Provider self-registration of signer addresses (`msg.sender == provider`
  calling `registerSigner`) means Cascade does not itself verify a
  registered signer is a genuine 0G-attested TEE key. That verification is
  a client-side/off-chain responsibility, consistent with
  `docs/trust-model.md` and the hybrid on-chain-recheck pattern established
  in prior research (off-chain verification, cheap on-chain signature
  recheck — never full on-chain attestation-quote verification).
