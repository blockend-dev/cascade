# Cascade — Trust Model

This document exists so that no security claim in this codebase is broader
than what actually backs it. If a claim here can't point to a mechanism, it
gets a weaker word than "proof," "trustless," or "guaranteed."

## Component trust table

| Component | Trusted for | If malicious |
|---|---|---|
| 0G Chain | Base settlement layer, inherited | Cascade fails entirely — out of scope to mitigate |
| Intel TDX | Hardware root of trust, inherited | Same as above |
| NVIDIA GPU confidential computing | Hardware root of trust, inherited; whether 0G implements composite CPU+GPU attestation is unconfirmed | Level 1 model-identity claim weakens toward Level 2 |
| 0G provider (non-wrapper) | Execution only, **not** model identity | Can serve a different model than declared, undetected, at Level 2/3 |
| 0G provider running the Cascade wrapper | Execution **and** model identity, insofar as the measured wrapper is correct | Attestation fails closed — cannot silently swap models |
| 0G Compute/Serving settlement contract | Unknown — source not publicly located (see ADR 0003) | Unknown; Cascade does not depend on it, so this cannot propagate into Cascade's own guarantees |
| Cascade `LineageRegistry` / `AttributionSettlement` | Arithmetic and state-transition correctness (open source, audited) | Standard smart-contract risk — a bug could misroute funds, mitigated by audit and the invariants in `docs/security-invariants.md`, not by this document |
| Cascade relayer | **Liveness only.** Never a source of truth. | Delay or censorship, never fabrication, redirection, or theft (any other relayer can resubmit) |
| Model owner | Untrusted by default | Can attempt false claims — checked by stake + challenge (Level 3) or by the wrapper (Level 1) |
| Lineage claimant | Untrusted by default | Same as above |
| Challenger | Untrusted, economically aligned | A spurious challenge costs their own bond |
| 0G Storage | Content-addressing soundness (standard Merkle-tree assumption) | Would break the immutability the wrapper and Level 1 depend on |
| User | Trusted only to pay for what they request | No new attack surface introduced |

## Five properties, kept separate on purpose

Collapsing these into one idea ("is it secure?") is exactly the mistake the
original Cascade thesis made before due diligence. They are tracked
separately here and in code comments.

### Safety — can someone get paid who shouldn't?

- **Level 1:** constrained by the wrapper's fail-closed hash check, the TEE
  attestation chain, and the settlement contract's independent signature
  verification. The strongest guarantee the system makes.
- **Level 2:** weaker. Attested-training evidence is circumstantial; serving
  identity is unbound unless the same model is also served at Level 1.
- **Level 3:** economic only — bounded by stake size and challenge
  incentives, not cryptography.

### Liveness — can someone prevent legitimate payment?

No single relayer can permanently block settlement; submission is
permissionless and duplicate-safe. A malicious or offline relayer causes
delay, never a permanent block, as long as at least one honest party
resubmits.

### Provenance — can someone invent lineage?

- **Level 1:** cryptographically constrained by construction.
- **Level 2:** evidence-backed but not strict derivation proof — see
  `docs/protocol-spec.md` for exactly what 0G fine-tuning does and does not
  establish.
- **Level 3:** a challengeable economic claim. False claims are possible
  until successfully challenged; unchallenged false claims are a known,
  documented residual risk of every optimistic-oracle design, not unique to
  Cascade.

### Execution integrity — can someone fabricate an inference proof?

No, assuming the signed TEE evidence and the registered signer's binding are
correctly verified — which the Cascade contract does independently, not by
trusting whatever a relayer submits.

### Model identity — can model B be passed off as model C?

- **Level 1:** the wrapper is specifically designed to prevent this.
- **Level 2/3:** this is **not prevented**. Documented, not hidden. Any
  public description of Cascade must say so for these levels — see
  `docs/protocol-spec.md`'s "permitted wording" section.

## Words this codebase does not use loosely

`trustless`, `proven`, `cryptographically guaranteed`, `immutable`,
`hardware-proven` — none of these appear in code comments, contract
NatSpec, or documentation unless the specific mechanism being described
actually establishes that property for that specific confidence level. When
in doubt, the weaker word is used.
