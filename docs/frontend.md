# Cascade Frontend (Phase 10)

`web/` is a model provenance, verification, and attribution explorer —
not a trust boundary. Every claim it renders is either copied verbatim
from indexed/on-chain data, or explicitly labeled as unavailable. See
ADR 0014 (indexer HTTP transport) and ADR 0015 (frontend stack) for the
architectural decisions this phase introduced.

## 1. Reconnaissance summary

- No existing frontend framework anywhere in the repository — `web/`
  was an unimplemented placeholder (`web/README.md`). Every other
  package is plain TypeScript + `ethers`, deliberately minimal.
- `sdk/` (Phase 8) is the only sanctioned write path — `createCascadeClient`
  gives read + write + usage + wrapperInfo APIs, EIP-712 signing, and
  `decodeCascadeError`. The frontend never signs a transaction, encodes
  calldata, or constructs a EIP-712 digest itself.
- `indexer/` (Phase 9) is the sanctioned historical/query read path —
  but it's a Node library built on `node:sqlite`, which does not exist
  in a browser. **This was the one requirement this phase's
  reconnaissance found unsupported by the existing SDK/indexer
  surface** — resolved, not by fabricating a frontend-only data source,
  but by adding a thin, additive HTTP query transport to the indexer
  itself (ADR 0014): `indexer/src/server.ts`, plus three new
  `query.ts` functions (`listModelsByOwner`, `listExecutionsByModel`,
  `listExecutionsByProvider`) backed by columns Phase 9 already
  projected. No indexed field was invented; only a transport and two
  new indexes were added.

## 2. Architecture

```
Blockchain ──events/state──▶ Indexer (Phase 9) ──HTTP JSON (ADR 0014)──▶ Frontend
Blockchain ◀──transactions── SDK (Phase 8) ◀──writes── Frontend
```

- **`web/src/api/indexerClient.ts`** — typed `fetch` wrapper over the
  indexer's HTTP routes (ADR 0014). Read-only. Never used for anything
  security-sensitive without a live cross-check (§5).
- **`web/src/wallet/`** — `ethers.BrowserProvider` around
  `window.ethereum` (EIP-1193), wired into `createCascadeClient` for
  writes. No wallet-connection library (ADR 0015).
- **`web/src/lineage/`** — the DAG layout/rendering (§4), pure
  functions over `EdgeRow[]`/`ModelRow[]` from the indexer, no network
  calls of its own.
- The frontend never re-implements: EIP-712 hashing, execution ID
  derivation, confidence composition, settlement arithmetic, or
  provenance cross-checks. Every one of those is either an indexer
  field (already computed by the contract, per docs/indexer.md §2's
  category A/B) or an SDK call.

## 3. Confidence presentation — the load-bearing requirement

Two independent axes, never merged, everywhere in the UI:

- **Lineage confidence** — `CascadeRegistry.ConfidenceLevel` on a
  specific edge (`Declared` / `AttestedTraining` / `CryptographicallyBound`).
- **Serving confidence** — `ExecutionRegistry`'s per-execution value,
  entirely independent of lineage (`Declared` / `CryptographicallyBound`
  only — `AttestedTraining` is never a valid serving confidence; see
  `docs/protocol-spec.md` §1 and ADR 0006).
- **Effective confidence** — `min(lineage, serving)` for one settled
  edge attribution — never computed by the frontend; always the exact
  `effectiveConfidence` value `AttributionSettlement` already emitted
  and the indexer already stored (`edge_attributions.effective_confidence`).

`web/src/confidence.ts` is the single place confidence enums are
labeled for display — the exact strings from `docs/protocol-spec.md`
§1 (`Declared`, `Attested Training`, `Cryptographically Bound`), never
`"Verified"`, never `"Proof of Training"`, never `"trustless"`. Every
component that shows a confidence value imports from this module
rather than hand-writing a label — the same "one source of truth"
discipline `sdk/src/eip712.ts` established for typed-data structures,
applied here to display strings instead of cryptography.

## 4. Lineage graph

`web/src/lineage/layout.ts` — a pure function `layoutDag(models: ModelRow[], edges: EdgeRow[]): GraphLayout`
producing layered (topological-generation) node positions; no
third-party graph library (ADR 0015). `web/src/lineage/LineageGraph.tsx`
renders it as SVG: solid vs. dashed vs. dotted stroke **and** a text
label per edge for lineage confidence (never color alone —
accessibility requirement), royalty bps and status shown on hover/click
and in a permanent `<table>` beneath the graph — the **textual
fallback** every "graph must have a non-visual representation"
requirement in the brief refers to. The table is the actual
accessible representation (real DOM, screen-reader/keyboard navigable);
the SVG is a visual enhancement over the same data, not a second data
source.

## 5. Data freshness — indexed vs. live

Every page that renders indexer data shows the indexer's
`/sync-status` (`docs/indexer.md`'s own "chain always wins" framing,
surfaced in UI as **"Indexed through block N"**, with an explicit
**stale** state once the indexer's reported lag exceeds a small
threshold). Before any write flow that depends on current state — a
claim, a challenge, an ownership-gated action — the frontend performs a
**live** SDK read (`client.read.*`) immediately before constructing the
transaction, and shows both values side by side if they disagree,
rather than silently trusting the indexed one. This applies concretely
to: claimable balance (`getClaimable`), model ownership (`getModel`),
provider signer registration, and edge challenge/finalization status.

## 6. Write flows

Every write goes through `createCascadeClient(...).write.*` /
`.usage.*` — registerModel, updateMetadataURI, transferModelOwnership,
revokeModel, registerLineageEdge, challengeEdge, resolveChallenge,
finalizeEdge, registerProviderSigner, registerProvenance,
claimAttribution. The frontend never takes a recipient address or a
payout amount as a form field feeding a *derived* value (challenge
bond and minimum stake are read live from `client.read.getCascadeRegistryParameters()`
and only ever pre-filled, never silently overridden by a client-typed
number past what the contract will accept). A pre-transaction summary
component (`web/src/tx/TxSummary.tsx`) states, in plain language, what
the pending transaction will do, before the wallet prompt appears; a
post-transaction result component shows the tx hash, a block-explorer
link (chain-config-driven, never hardcoded to one network), and the
resulting entity re-read from the chain — never marked "done" merely
because a hash came back, only after `sendAndWait`'s confirmation
(the SDK's own `tx.ts`, reused directly, not re-implemented).

## 7. Error handling

`decodeCascadeError` (SDK) is called on every caught write-flow error.
`web/src/errors.ts` maps known Cascade custom-error names (e.g.
`EdgeAlreadyExists`, `ChallengeWindowClosed`, `NotModelOwner`,
`ExecutionAlreadyConsumed`) to the plain-language messages the brief's
examples give; an undecodable error still surfaces (as
`decodeCascadeError` itself guarantees — see ADR/SDK docs) with a
"technical details" expandable section rather than a bare stack trace.

## 8. Security considerations

- Indexer responses never authorize a transaction — every write path's
  actual on-chain preconditions are enforced by the contracts
  themselves; the frontend's use of indexed data is presentation only.
- Contract addresses and chain ID come from build-time configuration
  (`web/src/config.ts`, `.env`-driven, mirroring every other package's
  convention), never a URL/query parameter.
- Model metadata URIs and other user-supplied strings are rendered as
  text content (React's default escaping), never `dangerouslySetInnerHTML`;
  external evidence URIs (`0g-storage://...`, provenance `evidenceURI`)
  are rendered as visibly-external links with the raw URI shown, not a
  clickable opaque label.
- Wrong-chain detection: the connected wallet's `chainId` is compared
  against `web/src/config.ts`'s configured chain on every wallet
  interaction; a mismatch blocks write actions with an explicit prompt
  to switch networks, never a silent no-op.

## 9. Production vs. development configuration

`web/.env.example` documents `VITE_RPC_URL`, `VITE_CHAIN_ID`,
`VITE_INDEXER_URL`, and the four contract addresses — same
environment-driven pattern as `relayer/` and `indexer/`. There is no
fixture/mock-data mode wired into the production build; any local
fixtures used only for component tests live in
`web/src/**/*.test.tsx`/`web/test/fixtures.ts`, imported only from test
files, never from application code.

## 10. Deployment requirements

`web/` builds to a static bundle (`npm run build` → `dist/`) —
deployable behind any static host. It requires, at runtime: an RPC
endpoint, an `indexer` HTTP server (ADR 0014) reachable from the
browser, and the four deployed contract addresses. It does not require
its own backend beyond the indexer's existing HTTP server.

## 11. Known limitations

- No wallet-connection library means only EIP-1193-compatible browser
  wallets are supported (MetaMask and equivalents) — WalletConnect
  (mobile/QR) is out of scope for this phase.
- The lineage graph's layout is a straightforward layered DAG layout,
  not a general-purpose force-directed layout — sufficient for this
  protocol's bounded graph sizes (`maxDepth` 8, `maxParentsPerModel`
  16), not intended to scale to arbitrarily large unrelated graphs.
- No production analytics/telemetry — out of scope, and would cut
  against the brief's "no fake activity/metrics" instruction if done
  carelessly.
- **Neither `npm test` (Vitest) nor `npm run build`'s `vite build`
  step could be executed in this development environment**, and this
  is disclosed rather than papered over. This repository's working
  directory is a UNC network path (`\\wsl.localhost\...`); Vite's
  toolchain breaks on it in at least two distinct, separately-verified
  ways: `vite-node` (used by Vitest) computes a Windows drive letter
  from `process.cwd()[0]`, building an invalid regular expression on a
  UNC cwd; and, independently of that (reproduced by running `vite
  build` directly, no workaround applied), Vite's own
  config-bundling step fails to resolve the `vite` and
  `@vitejs/plugin-react` package entries via esbuild when
  `node_modules` itself sits under a UNC path — an esbuild/Windows
  resolver limitation, not a project misconfiguration (confirmed by
  inspecting vite-node's source directly after the first crash, and by
  reproducing the second failure with zero project-side workarounds
  applied). This is the same class of environment constraint
  documented for Phase 7's native-module build problem and Phase 9's
  `node:sqlite` choice — a real tooling limitation of this specific
  machine/path combination, not a defect in the application or test
  code. Consequence, stated plainly: the ~60 component/unit tests
  under `web/test/` and `web/src/**/*.test.ts(x)` are written and
  type-check cleanly (`tsc --noEmit` passes with zero errors across
  all of `web/src` and `web/test`, including every test file), and the
  production build's type-check (`tsc --noEmit`, the first half of
  `npm run build`) also passes cleanly — but neither Vitest execution
  nor the `vite build` bundling step itself could be run here; both
  should work normally on a standard, non-UNC checkout. Independently,
  and entirely unaffected by this issue (it runs through Hardhat/
  ts-node, not Vite), the frontend's actual **data-fetching and layout
  logic** — the indexer HTTP client, bounded lineage-subgraph
  traversal, and DAG layout — is verified for real against a live
  Hardhat chain and a live indexer HTTP server in
  `contracts/test/web/dataLayer.test.ts` (7 tests, all passing),
  following this repository's own established discipline of testing
  against real deployed contracts, not mocks, for exactly the logic
  that most needs it.
