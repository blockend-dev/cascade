# web

Phase 10. Cascade's model provenance, verification, and attribution
explorer — **never a trust boundary**. Every claim it renders is either
copied verbatim from indexed/on-chain data via `indexer/`'s HTTP query
server (ADR 0014) or the SDK's direct contract reads, or explicitly
labeled unavailable. See [`docs/frontend.md`](../docs/frontend.md) for
the full architecture, and
[`docs/adr/0015-frontend-stack.md`](../docs/adr/0015-frontend-stack.md)
for why this stack (React + Vite, no heavy UI/graph/routing libraries).

## Run

```
npm install
cp .env.example .env   # fill in RPC_URL, chain id, indexer URL, contract addresses
npm run dev
```

Requires `indexer/`'s HTTP query server running and reachable (`npm run dev`
in `indexer/`, see its own README) and an RPC endpoint for the
configured chain.

```
npm run build     # type-check + static production build -> dist/
npm test          # Vitest component/unit tests
```

## Structure

| Module | Responsibility |
|---|---|
| `src/config.ts` / `src/types.ts` | Environment-driven configuration; `AppConfig`'s type lives separately from the Vite-specific loader — see `types.ts`'s own header comment for why. |
| `src/api/indexerClient.ts` | Typed HTTP client for the indexer's query server (ADR 0014). Read-only. |
| `src/wallet/WalletContext.tsx` | Hand-rolled `window.ethereum` wallet connection, wired into `createCascadeClient` from `sdk/`. |
| `src/confidence.ts` | Single source of truth for confidence-level display strings — never hand-written per component. |
| `src/lineage/` | Pure DAG layout (`layout.ts`), bounded subgraph fetch (`fetchSubgraph.ts`), and the SVG+table graph component. |
| `src/tx/` | Transaction lifecycle (pending/confirmed/failed) around SDK write calls. |
| `src/errors.ts` | Plain-language messages for Cascade's decoded contract errors. |
| `src/router.tsx` | Minimal hash-based client-side router (ADR 0015). |
| `src/pages/` | The seven core experiences — Model Explorer, Model Detail, Execution, Owner Dashboard, Provider, About. |

Component/unit tests live in `web/test/` (Vitest + Testing Library, fast,
fixture-based — never against real chain state). Data-layer
correctness tests (the indexer HTTP client, lineage subgraph fetching,
and layout against a *real* deployed Cascade + real indexer) live in
`contracts/test/web/`, following this repository's established pattern
of testing against real deployed contracts, not mocks.

Note: `package.json` deliberately has no `"type": "module"` field, even
though this is a Vite/ESM-tooled app — `contracts/test/web/`'s tests
import plain data-layer modules (`indexerClient.ts`, `lineage/*.ts`,
`confidence.ts`) directly into Hardhat's CommonJS ts-node context, which
cannot `require()` a package whose nearest `package.json` declares
`"type": "module"`. Vite itself doesn't require that field to work.

Note: `npm test` and `vite build` could not be executed in this
project's original Windows/UNC-path development environment (a real
Vite/esbuild toolchain limitation, not a code defect) — see
[`docs/frontend.md`](../docs/frontend.md) §11 for the full, verified
explanation. `tsc --noEmit` passes cleanly across all source and test
files regardless.
