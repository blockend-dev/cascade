# ADR 0002 — Repository layout and contract tooling

## Status
Accepted

## Context
The target layout separates `contracts/`, `wrapper/`, `relayer/`, `sdk/`,
`indexer/`, `web/`, `tests/`, `docs/` at the repository root. Foundry was
the first choice for contract tooling (native fuzz/property testing fits
the invariant-heavy design directly), but this development environment has
Node.js/npm available and no Foundry installation, and installing a new
Rust-based toolchain was judged a worse first commit than using what's
already here reliably.

## Decision
- **Hardhat + TypeScript** for the contracts project, under `contracts/`,
  with Solidity sources in `contracts/src/` and tests in `contracts/test/`
  (Hardhat's config points `sources` at `src` rather than using the
  Hardhat-default `contracts/contracts/` nesting, which would collide
  awkwardly with the repo's own top-level `contracts/` directory name).
- **OpenZeppelin Contracts** for `Ownable`, `ReentrancyGuard`, `ECDSA`, and
  `EIP712` base implementations rather than hand-rolling primitives that
  are easy to get subtly wrong.
- **mocha/chai** (via `hardhat-toolbox`) for unit and integration tests.
  Property/fuzz-style coverage for the DAG invariants (no-cycle, bounded
  depth, weakest-link resolution) is implemented as seeded randomized-input
  tests within the same suite rather than via a dedicated fuzzing engine,
  since Foundry's `forge` fuzzer isn't available in this environment. If
  Foundry becomes available later, migrating the invariant suite to native
  fuzz tests is straightforward and should be revisited — this is a
  tooling-availability decision, not a design preference.
- **Root-level `tests/`** is reserved for cross-component integration tests
  (contracts + relayer + wrapper interacting together, once those phases
  exist). Each component keeps its own unit tests colocated per that
  ecosystem's own convention — `contracts/test/` for Solidity/Hardhat,
  future `relayer/test/`, `sdk/test/`, etc. This avoids fighting each
  toolchain's default test-discovery behavior for the sake of a uniform
  top-level directory that would just be re-pointed-to anyway.

## Consequences
- A reader expecting Foundry's `forge test` will need to run
  `npm test` inside `contracts/` instead. Documented here and in
  `contracts/README.md`.
- Revisit if/when Foundry is installed in the working environment.
