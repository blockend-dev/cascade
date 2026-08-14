# wrapper — Phase 7 (not yet implemented)

The Cascade-authored attested serving wrapper: the only path to Level 1
(cryptographically bound) confidence. Verifies a model's hash against its
registered commitment before loading it, fails closed on mismatch, and is
built for reproducible measurement.

See `docs/protocol-spec.md` and `docs/threat-model.md` (#18–22) for the
exact requirements this must satisfy before it's implemented: immutable
content-addressed model references only, no mutable aliases, pinned
dependencies, documented build/measurement procedure so an independent
party can reproduce the expected attestation.

Blocked on confirming whether 0G's provider onboarding permits custom
serving images — see `docs/architecture.md`, "open blockers."
