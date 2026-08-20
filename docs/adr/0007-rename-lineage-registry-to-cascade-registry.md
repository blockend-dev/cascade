# ADR 0007 — Rename LineageRegistry to CascadeRegistry

## Status
Accepted

## Context
"LineageRegistry" is also the name of an unrelated, existing "Lineage
Protocol" project. Continuing to use it as Cascade's core contract name
risks confusion between two unrelated systems.

## Decision
The contract, file, and every reference to it as a proper noun are renamed
`LineageRegistry` → `CascadeRegistry`: `contracts/src/LineageRegistry.sol` →
`contracts/src/CascadeRegistry.sol`, `contracts/test/LineageRegistry.test.ts`
→ `contracts/test/CascadeRegistry.test.ts`, and every mention across
`ExecutionRegistry.sol`, its test file, and `docs/`.

**"Lineage" is preserved everywhere it names the technical concept, not the
contract identity** — `LineageEdge`, `registerLineageEdge`,
`getParentEdgeIds`, "lineage confidence," "lineage DAG," "the lineage
graph," and so on are all unchanged. Cascade's product/contract identity
changes; the ancestry-graph vocabulary it's built on does not.

ADR 0004's title is left as originally recorded (a historical decision
title), with a note pointing here, rather than rewritten — its body text
uses the current name. ADR 0005 and ADR 0006, written in the same working
session just before this rename, had their titles updated along with their
bodies, since treating them as "historical" the moment after they were
written would read as an inconsistency rather than genuine project history.

## Consequences
- No semantic change to any contract's behavior. Confirmed by running the
  full test suite unmodified in substance (only the factory name string and
  local variable names changed) after the rename — see the commit history
  for this ADR's accompanying change.
- Any external references to `LineageRegistry` (deployment scripts, ABIs,
  documentation outside this repository) written before this ADR are now
  stale. None exist yet — this repository has not been deployed anywhere
  external — so there is nothing else to migrate.
