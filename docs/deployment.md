# Cascade — Deployment

How to deploy the four Cascade contracts and wire their addresses into
`sdk/`, `relayer/`, `indexer/`, and `web/`. This document is scoped
strictly to deploying Cascade's own contracts — it introduces no
dependency on, or integration with, 0G's own Compute/Serving settlement
contract (see ADR 0003, unchanged).

## What gets deployed, and in what order

Verified directly against each contract's constructor
(`contracts/src/*.sol`) before writing the deploy script — not assumed:

```
1. CascadeRegistry(resolver)
2. ExecutionRegistry(cascadeRegistry)
3. AttributionSettlement(cascadeRegistry, executionRegistry)
4. TrainingProvenanceRegistry(cascadeRegistry, executionRegistry)
```

Every constructor argument after the first step is the address of a
contract deployed in an earlier step — there is no other dependency
ordering that satisfies all four constructors. No contract has a
post-deployment "wire it up" setter to call afterward — every
cross-contract reference (`cascadeRegistry`, `executionRegistry` on the
dependent contracts) is a `public immutable` set once, at construction,
and never changed. `TrainingProvenanceRegistry` and
`AttributionSettlement` both depend on the same two prior contracts but
not on each other, so their relative order doesn't matter — the script
deploys them in the order listed above for a stable, predictable log,
nothing more.

## Prerequisites

- `contracts/` dependencies installed (`npm install`) and the contracts
  compiled (`npm run build` — the deploy script also compiles
  automatically via `hardhat run`, this just fails fast if something's
  broken).
- An RPC endpoint for the target network, and a funded deployer account.
  Neither is provided by this repository — see `contracts/.env.example`.

## Configuration

Copy `contracts/.env.example` to `contracts/.env` and fill in:

| Variable | Required | Meaning |
|---|---|---|
| `RPC_URL` | Yes, for any non-Hardhat network | The RPC endpoint to deploy to. Unset means `hardhat.config.ts` doesn't define the `target` network at all. |
| `CHAIN_ID` | No | Inferred from `RPC_URL` if unset. |
| `DEPLOYER_PRIVATE_KEY` | Yes, for any non-Hardhat network | Development-convenience raw key. Production deployments should replace this with a hardware-wallet/KMS-backed signer — out of scope for this script, same caveat `relayer/.env.example` already states for its own signing key. |
| `RESOLVER_ADDRESS` | Strongly recommended | `CascadeRegistry`'s challenge resolver (ADR 0004) — a real, deliberately chosen address. If unset, the script defaults to the deploying account and prints a loud warning; fine for local/test use, not a decision to make silently for a real deployment. |
| `CONFIRMATIONS` | No | Confirmations to wait for after each deployment tx before continuing. Defaults to 1. |

Hardhat does not auto-load `.env` files. Export the variables into your
shell, or run through a tool like `dotenv-cli`:

```bash
npx dotenv -e .env -- npm run deploy -- --network target
```

## Running it

Against Hardhat's own local/ephemeral network (safe, no real funds, no
persistent state — exactly what proves the script's own logic works):

```bash
cd contracts
npm run deploy -- --network hardhat
```

Against a real network, once `.env` is populated:

```bash
cd contracts
npm run deploy -- --network target
```

The script, in order:

1. Deploys all four contracts in the order above, printing each address
   as it goes.
2. **Verifies the deployment** — reads `resolver()` off `CascadeRegistry`
   and `cascadeRegistry()`/`executionRegistry()` off the three dependent
   contracts, and asserts each one matches what was actually deployed.
   A wrong-order deploy, a copy-paste address mistake, or an RPC that
   silently misrouted a transaction is caught here, immediately — the
   script throws and exits non-zero rather than reporting success.
3. Writes `contracts/deployments/<network>.json` (chain ID, deployer,
   resolver, timestamp, all four addresses). If a record already exists
   for that network, it's backed up first, never silently overwritten.
4. Prints the exact environment-variable lines to copy into
   `relayer/.env`, `indexer/.env`, and `web/.env`.

## Supplying addresses downstream

Every downstream package already has its own `.env.example` — the
deploy script's final output lines are the values to fill in:

| Package | Variables | File |
|---|---|---|
| `relayer/` | `CASCADE_REGISTRY_ADDRESS`, `EXECUTION_REGISTRY_ADDRESS`, `ATTRIBUTION_SETTLEMENT_ADDRESS` | `relayer/.env` |
| `indexer/` | `CASCADE_REGISTRY_ADDRESS`, `EXECUTION_REGISTRY_ADDRESS`, `ATTRIBUTION_SETTLEMENT_ADDRESS`, `TRAINING_PROVENANCE_REGISTRY_ADDRESS`, and `START_BLOCK` (set to the deployment's block number, so backfill doesn't scan from genesis) | `indexer/.env` |
| `web/` | The same four addresses, `VITE_`-prefixed | `web/.env` |
| `sdk/` | Not environment-driven — a consumer passes `addresses: CascadeAddresses` directly to `createCascadeClient(...)` | *(caller-supplied)* |

`sdk/` itself has no `.env` — it's a library, not a deployed process; it
takes addresses as a constructor argument from whichever package embeds
it (as `relayer/`, `wrapper/`, and `web/` all already do).

## What this script deliberately does not do

- Does not touch 0G's own settlement contract in any way (ADR 0003).
- Does not register any provider signers, providers, or models — that's
  runtime configuration by the protocol's actual users, not part of
  bringing the protocol itself into existence.
- Does not transfer contract ownership away from the deploying account.
  `CascadeRegistry`, `ExecutionRegistry`, and `AttributionSettlement`
  are all `Ownable`, deployer-owned by default; transferring ownership
  to a different operational key (e.g. a multisig) is a deliberate,
  separate decision an operator makes afterward via each contract's own
  `transferOwnership`, not something this script should decide silently.
- Does not manage a production signing key — `DEPLOYER_PRIVATE_KEY` is
  documented, in `.env.example` itself, as development-convenience
  only.

## Test-only deployment stays separate

`contracts/test/sdk/helpers.ts`'s `deployCascadeStack()` (and its
equivalents used throughout `contracts/test/**`) exists purely for
tests: it uses Hardhat's auto-generated signers and picks an arbitrary
signer as resolver, for test convenience. `contracts/scripts/deploy.ts`
does not import it, call it, or share any of its assumptions — the two
are deliberately independent so that "make deployment work" and "make
tests fast to write" never trade off against each other.
