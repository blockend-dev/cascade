# Cascade — Threat Model

Actors, assets, and the attack list the protocol is designed against. Every
attack below has one of: a concrete prevention mechanism, an explicit
economic limitation, or a documented out-of-scope assumption. None are left
unaddressed silently.

## Actors

- **Model owner** — registers a model and its lineage edges.
- **Provider** — runs a 0G Compute Network deployment serving a model.
- **User** — pays for and consumes inference.
- **Relayer** — permissionless party that submits usage proofs to Cascade.
  Liveness/convenience only, per `docs/trust-model.md`.
- **Ancestor** — an address entitled to a share of attribution fees via a
  finalized lineage edge.
- **Challenger** — stakes a bond to dispute a Level 3 (or, in principle, any)
  lineage claim during its challenge window.
- **Resolver** — the party that adjudicates a challenge. MVP: a role-gated
  address (see Limitations). Documented, not hidden.

## Assets

- Attribution fee balances held by `AttributionSettlement`, pending claim.
- Registration and challenge stakes held by `CascadeRegistry`.
- The integrity of the lineage graph itself (who is whose ancestor, at what
  royalty share, at what confidence level).
- The integrity of registered `TrainingProvenanceRegistry` records — an
  immutable, provider-attested claim about how a model was trained.

## Attack catalogue

| # | Attack | Disposition |
|---|---|---|
| 1 | Replayed usage proof | **Prevented.** Usage proofs carry a canonical unique identifier (request hash + provider + epoch); consumed identifiers are rejected on resubmission. |
| 2 | Modified response | **Prevented.** Response hash is bound into the signed TEE payload; a modified response fails signature verification. |
| 3 | Modified request | **Prevented.** Same mechanism — request hash is bound into the signed payload. |
| 4 | Provider substitution | **Prevented.** Provider identity is bound into the signed payload; crediting a different provider requires forging its registered signer's signature. |
| 5 | Model substitution | **Prevented at Level 1** (wrapper fails closed on hash mismatch). **Not prevented at Level 2/3** — documented limitation, see `docs/trust-model.md`. |
| 6 | Cross-model attribution (proof for B submitted as usage of C) | Same as #5 — Level 1 only. |
| 7 | Cross-provider attribution | **Prevented.** See #4. |
| 8 | Cross-user attribution | **Limited impact by design.** Misattributed usage does not redirect the underlying fee; the user's own payment authorization is separately signed. |
| 9 | Malicious relayer | **Bounded to delay/censorship only.** Cannot fabricate, redirect, or determine attribution — payout recipients are derived from the on-chain lineage graph, never relayer input. Permissionless resubmission by any other relayer restores liveness. |
| 10 | Duplicate settlement | **Prevented.** Epoch + usage-proof-identifier keyed replay protection. |
| 11 | Recipient substitution | **Prevented.** Recipients are computed from `CascadeRegistry` state, never accepted as relayer input. |
| 12 | Lineage cycle | **Prevented.** Bounded ancestor walk at edge-registration time (see `MAX_DEPTH` in `docs/security-invariants.md`); a would-be cycle is rejected before it can be registered. |
| 13 | Extremely deep lineage | **Bounded, not prevented.** Hard-capped `MAX_DEPTH`. Ancestors beyond the cap simply receive no credit — a disclosed limitation, not a silent failure. |
| 14 | Malicious ancestry split (royalty bps gaming) | **Prevented.** Sum of an edge's declared bps is checked against a hard cap at registration; a child's total upstream allocation cannot exceed `MAX_TOTAL_BPS`. |
| 15 | Challenge griefing (spam challenges to freeze legitimate edges) | **Economically limited.** Challenge requires a bond; a spurious challenge forfeits it. |
| 16 | Expired challenge (finalize too early / dispute after window) | **Prevented.** Finalization checks `block.timestamp > challengeDeadline` and `status != Challenged`. |
| 17 | Invalid stake (under-collateralized claim) | **Prevented.** Registration reverts if `msg.value < MIN_STAKE`. |
| 18 | Wrapper modification (Level 1) | **Prevented.** Any modification changes the measured hash; attestation fails against the known-good reference. See `docs/trust-model.md`. |
| 19 | Mutable model pointer (e.g. "latest") | **Prevented by policy + design.** The wrapper only accepts immutable, content-addressed 0G Storage root hashes read live from `CascadeRegistry` — never a separately-configurable or mutable alias. Implemented in `wrapper/src/lifecycle.ts`; verified directly by test (`contracts/test/wrapper/lifecycle.test.ts`), not merely asserted. |
| 20 | Post-verification model replacement | **Mitigated, not eliminated.** The wrapper's own logic must refuse to reload a different model after its initial verified load; that refusal logic is itself part of the measured launch configuration. Documented residual trust: the wrapper's source correctness. |
| 21 | Proxying inference outside the wrapper | **Prevented.** Different code than what's measured; caught by the same attestation-measurement check as any other modification. |
| 22 | Unpinned runtime dependency (supply-chain drift) | **Mitigated by build discipline.** Reproducible builds, pinned dependencies. Standard confidential-computing hygiene, not a Cascade-specific mechanism — documented as an MVP requirement, not automatic. |
| 23 | Malformed EIP-712 signature | **Prevented.** Standard EIP-712 domain separation and typed-data verification; malformed signatures fail `ecrecover` checks or recover to an unregistered address. |
| 24 | Signature replay across chains | **Prevented.** EIP-712 domain separator includes `chainId`. |
| 25 | Signature replay across contracts | **Prevented.** EIP-712 domain separator includes `verifyingContract`. |
| 26 | Epoch replay | **Prevented.** Settlement submissions are keyed by epoch; a settled epoch cannot be resubmitted. |
| 27 | Settlement rounding / dust manipulation | **Bounded.** Integer-division remainders accumulate to a disclosed dust pool, never silently dropped or exploitable for repeated extraction — see `docs/security-invariants.md`. |
| 28 | Withdrawal / reentrancy | **Prevented.** Pull-payment pattern with checks-effects-interactions and a reentrancy guard on claim functions. |
| 29 | Unauthorized model update | **Prevented.** Only the registered owner may update metadata or revoke; ownership transfer is a distinct, logged event. |
| 30 | Lineage mutation after settlement | **Prevented.** A finalized edge's confidence level and royalty share are immutable; revocation stops future children, never retroactively claws back already-settled royalties. |
| 31 | Provider refuses to participate in Cascade at all | **Not preventable — stated limitation.** Cascade is opt-in. No cryptographic or economic mechanism forces a non-participating provider to pay attribution fees. |
| 32 | Forged training provenance (garbage or unregistered-signer signature) | **Prevented.** `registerProvenance` recovers the signer via ECDSA and requires `ExecutionRegistry.providerOfSigner(signer) != address(0)` — the same registered-provider trust anchor `UsageProof` verification uses. |
| 33 | Provenance claim with a mismatched result/base commitment | **Prevented.** Cross-checked at registration against `CascadeRegistry.getModel(...).modelCommitment`; mismatches revert rather than register. |
| 34 | Provenance claim tampered post-signing (dataset, script, or any signed field) | **Prevented.** Every field is part of the EIP-712-signed struct; any modification invalidates the signature, same mechanism as `UsageProof` tamper resistance (#2, #3). |
| 35 | Unauthorized provenance registration (not the model owner) | **Prevented.** Requires `msg.sender == CascadeRegistry.getModel(childModelId).owner`. |
| 36 | Provenance replay / mutation after registration | **Prevented.** One record per `childModelId`, ever — no update function exists; a second registration attempt (even with "corrected" values) reverts. |
| 37 | Provenance cross-chain / cross-contract replay | **Prevented.** EIP-712 domain separator binds `chainId` and `verifyingContract` — identical mechanism to `UsageProof` (#24, #25). |
| 38 | Representing a Level 2 (training-provenance) claim as Level 1 (cryptographically bound) | **Structurally prevented, not policy-prevented.** `CascadeRegistry` doesn't distinguish the source of an edge's `evidenceHash`, so nothing stops the label from being applied — but `servingConfidence` (the only source of Level 1 status) lives entirely in `ExecutionRegistry` with no dependency on `CascadeRegistry` lineage labels, so the mislabeling cannot raise `min(lineage, serving)` above whatever `servingConfidence` actually is. See ADR 0006, ADR 0010. |

## Explicit non-goals (out of scope, by design)

- Detecting or preventing a provider from serving a model outside 0G
  entirely (weight exfiltration / self-hosting). This is the general DRM
  problem; no cryptographic fix exists. See `The Cascade Audit` (prior
  research) for the full argument.
- Proving training derivation for anything not produced via 0G's own
  fine-tuning service, beyond a staked, challengeable declaration (Level 3).
- Full on-chain verification of TDX/NVIDIA GPU attestation quotes. Not
  standard practice anywhere; the hybrid off-chain-verify/on-chain-recheck
  pattern is used instead (see `docs/protocol-spec.md`).
