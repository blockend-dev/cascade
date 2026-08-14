# tests — cross-component integration

Reserved for tests that exercise more than one component together (e.g.
relayer submitting against a live `AttributionSettlement`, or the wrapper's
attestation feeding a real Level 1 registration end to end), once those
components exist. Component-local unit and fuzz tests live with their own
component — see `docs/adr/0002-repo-layout-and-tooling.md`.
