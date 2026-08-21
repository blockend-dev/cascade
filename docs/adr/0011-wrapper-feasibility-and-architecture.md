# ADR 0011 — Phase 7 feasibility confirmed; wrapper built as a standalone package with zero contract changes

## Status
Accepted

## Context — the feasibility question

Every prior research pass (*The Cascade Verdict*, *The Cascade Gate*, and
ADR 0006/0010) flagged the same open blocker: does 0G's provider
onboarding actually permit deploying a custom serving image, or must
providers use a fixed, 0G-supplied one? Until this was answered from
primary sources, Level 1 (`CascadeWrapper` mode) could not honestly be
called deployable — it was owner-attested-only, explicitly documented as
a placeholder.

## What was actually verified

Primary source: `docs.0g.ai/developer-hub/building-on-0g/compute-network/inference-provider`
(the "Inference Provider Setup" guide, fetched directly, twice, with
different extraction prompts, for consistency). Its documented onboarding
flow:

1. The provider prepares **their own model service** — the docs' exact
   requirement: *"Your AI service must implement the OpenAI API Interface
   for compatibility."* No further constraint on what that service is or
   how it's built.
2. The provider downloads and configures 0G's own **Inference Broker**
   (from 0G's releases) — this is the component that handles routing,
   payment, and TEE-signed attestation; it is 0G-supplied and unmodified.
3. A TEE node is set up via **Dstack** or **Cryptopilot**.
4. `./config` generates a `docker-compose.yml` composing the provider's
   model service together with the broker; `docker compose up` launches
   both inside the TEE.

No approval, review, or whitelisting step is mentioned anywhere in the
guide, across either extraction pass.

**Independent corroboration**: Dstack (`github.com/Dstack-TEE/dstack`),
one of the two documented deployment paths, is a third-party, open-source,
Linux-Foundation-audited framework (Phala Network + Flashbots) whose own
documentation states its purpose plainly: *"bring your Docker containers
as-is"* into a TDX-based confidential VM with attestation. This is not
0G-specific tooling with an undocumented gate — it's a general framework
0G references, and its own stated purpose is exactly "arbitrary container,
attested."

## Conclusion

**Confirmed, from primary sources, not inferred from architecture
diagrams**: a Cascade-authored, reproducibly-built container implementing
the OpenAI API interface can be deployed as the model-service half of a
standard 0G Compute provider, composed with 0G's own Inference Broker,
with no documented approval gate. This resolves the blocker every prior
pass left open. Residual uncertainty, disclosed rather than papered over:
web-documentation research cannot substitute for an actual deployment
against live 0G infrastructure, which this environment has no access to
(no testnet credentials, no TDX/H100 hardware) — the conclusion is "the
documented path exists and contains no stated gate," not "a Cascade
wrapper has been deployed and confirmed working in production."

## Decision — Phase 7 architecture

Given confirmation, Phase 7 is built as `wrapper/` — a standalone
TypeScript package, mirroring `relayer/`'s structure and conventions
(own `package.json`, own tests, own docs). It is *not* a smart contract
change:

- **`ExecutionRegistry.sol` is not modified.** `setProviderMode` remains
  exactly as Phase 3 left it — owner-gated, and still, honestly, a
  placeholder in the sense that flipping a provider to `CascadeWrapper`
  mode is still a decision made by the contract owner, not something the
  chain verifies cryptographically (full on-chain TDX/NVIDIA quote
  verification remains out of scope — established in prior research as
  infeasible/non-standard, unchanged by this phase).
- **What Phase 7 actually strengthens** is *what that owner decision is
  based on*. Before Phase 7: nothing — an arbitrary flag. After Phase 7:
  a documented, independently-repeatable verification procedure
  (`wrapper/MEASUREMENT.md`) anyone can follow to check whether a
  specific provider's live attestation matches the wrapper's published,
  reproducibly-built measurement — using the same manual tools 0G's own
  documentation already points to (`dstack-verifier`, `sigstore`), not a
  reimplementation of TEE quote verification. This turns "owner says
  trust me" into "owner's claim is checkable by anyone, and wrong if
  challenged" — a real improvement, honestly scoped as still
  fundamentally an off-chain-verified, on-chain-registered claim, exactly
  the hybrid pattern established in prior research (never full on-chain
  attestation verification).
- **The wrapper's actual model-loading responsibility** — download by
  content-addressed hash, verify before load, fail closed, never accept a
  mutable alias — uses `@0gfoundation/0g-storage-ts-sdk`'s
  `Indexer.download(rootHash, outputPath, withProof)`, confirmed from
  `docs.0g.ai/developer-hub/building-on-0g/storage/sdk` directly. The
  `rootHash` it downloads by is the exact same value already stored as
  `CascadeRegistry.Model.modelCommitment` — no new identifier scheme
  introduced.
- **Inference itself is out of scope.** Actually running an LLM requires
  GPU/TDX hardware this environment does not have. The wrapper defines a
  pluggable `ModelBackend` interface and ships a minimal reference/stub
  backend sufficient to prove the verify-then-serve lifecycle end to end;
  swapping in a real inference engine (vLLM, TGI, etc.) is documented as
  the production integration point, not built here.
- **TEE attestation/signing is not the wrapper's job.** Per the confirmed
  provider architecture, 0G's own Inference Broker — not the model
  service — handles TEE-signed attestation and payment routing. The
  wrapper does not reimplement this; it only needs to be the thing the
  broker wraps.

## Consequences

- Zero changes to any Solidity contract. All 127 existing tests remain
  untouched and passing.
- The wrapper is genuinely testable in this environment (mocked storage
  client, stub model backend) for its own logic — hash verification,
  fail-closed behavior, immutable-reference-only enforcement — while
  honestly labeled as not end-to-end-tested against real 0G
  infrastructure, which no available tooling here can provide.
- `docs/trust-model.md`'s Level 1 wording can now say "deployable," not
  "blocked pending confirmation" — but must still say "not yet deployed
  and independently attestation-verified in production," which remains
  true and should stay true until someone actually runs it against live
  0G infrastructure and checks the resulting attestation.
