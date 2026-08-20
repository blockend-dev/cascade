# ADR 0004 — Challenge mechanism lives inside LineageRegistry

*Title kept as originally recorded — the contract discussed here is what
ADR 0007 later renamed to `CascadeRegistry`. Body text below uses the
current name.*

## Status
Accepted

## Context
A separate `ChallengeManager` contract was considered. The challenge
mechanism only ever operates on `LineageEdge` state (stake, deadline,
status) that `CascadeRegistry` already owns; splitting it out would mean
either duplicating that state or making every challenge call cross a
contract boundary to read and mutate state it doesn't itself hold.

## Decision
Challenge and finalization logic (`challengeEdge`, `resolveChallenge`,
`finalizeEdge`) are functions on `CascadeRegistry` itself, operating
directly on `LineageEdge.status`, `.stake`, and `.challengeDeadline`. No
separate contract.

## Consequences
- One fewer contract to deploy, audit, and keep in sync.
- `CascadeRegistry` is a larger contract than a minimal registry would be.
  Accepted — the alternative (cross-contract state duplication) is a worse
  source of bugs than a larger single contract with clearly separated
  function groups.
- The MVP challenge resolver (`resolveChallenge`) is a role-gated address,
  not a decentralized adjudication mechanism (e.g. an optimistic-oracle
  integration). This is a known centralization point, documented in
  `docs/threat-model.md` under "Resolver," and listed as future work rather
  than solved now — building a real dispute-resolution mechanism is a
  separate, substantial problem that would otherwise block Phase 1
  entirely.
