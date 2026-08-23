# ADR 0015 — Frontend stack: React + Vite, no heavy UI/graph/routing libraries

## Status
Accepted

## Context

No package in this repository has established a frontend framework
convention — `web/README.md`'s Phase 0 placeholder says "minimal
demonstration frontend" and nothing more specific. Every other package
(`relayer/`, `wrapper/`, `sdk/`, `indexer/`) is plain TypeScript against
`ethers` with a deliberately small dependency footprint, no framework
beyond what each package's core job strictly needs. Phase 10 has to
make a first choice here, not preserve one.

The frontend brief's own requirements — a componentized, stateful,
multi-page app with wallet connection, an interactive graph, and
protocol-aware forms — genuinely need *something* beyond raw DOM
manipulation to stay maintainable; the question is how much.

## Decision

- **React 18 + TypeScript + Vite.** React because the app is
  genuinely componentized and stateful (wallet connection state,
  in-flight transaction state, indexed-data caching) — hand-rolling
  that in vanilla DOM would be more code and more bug surface, not
  less, working directly against the brief's own "avoid dashboard
  clutter... prioritize clarity" goal. Vite because this is a pure
  client-side SPA with no server-rendering need (every write goes
  through a browser wallet; every read goes through the indexer's HTTP
  API or a JSON-RPC endpoint) — Next.js's SSR/API-route machinery would
  be unused weight.
- **No wallet-connection library** (no wagmi, no RainbowKit, no
  Web3Modal). Wallet connection here is one thing: ask
  `window.ethereum` (EIP-1193) for accounts, wrap it in
  `ethers.BrowserProvider`, hand the resulting signer to
  `createCascadeClient` from `sdk/`. `ethers` is already this
  repository's one blockchain library everywhere; a dedicated
  connection library would be a second abstraction over the same
  handful of calls.
- **No graphing library** (no d3, no Cytoscape, no React Flow). Every
  lineage graph this protocol can produce is bounded by
  `CascadeRegistry.maxDepth` (8) and `maxParentsPerModel` (16) —
  small, not general-purpose-graph-library territory. A hand-built SVG
  layered layout (`web/src/lineage/layout.ts`) is a few hundred lines,
  fully under this project's control (needed anyway to render
  `Declared`/`AttestedTraining`/`CryptographicallyBound` edges
  distinctly via label/pattern, not color alone — a generic graph
  library's styling API would be fought, not leveraged, to get that
  right), and keeps the dependency count at zero for this.
- **No CSS framework** (no Tailwind, no MUI, no Chakra). The brief is
  explicit that this must not look like "a generic Web3 dashboard" or
  "generic SaaS" — plain CSS with custom properties gives full,
  unfought control over the restrained, technical visual language the
  brief asks for, and avoids inheriting any component library's own
  default aesthetic.
- **No routing library.** A hand-rolled ~80-line History-API router
  (`web/src/router.tsx`) covers this app's seven routes. `react-router`
  is a reasonable, common choice, but this app doesn't need nested
  routes, data loaders, or any of what it provides beyond "map a path
  to a component" — adding it would be exactly the kind of "large UI
  framework... unless there is a strong reason" the brief warns against
  when a much smaller, fully-inspectable alternative covers the actual
  need.
- **Vitest + @testing-library/react + jsdom** for tests — the natural
  Vite-ecosystem pairing (shares Vite's config/transform, no second
  bundler-config surface the way Jest would require).

## What was deliberately not chosen and why

- **Next.js / Remix** — server-rendering and API routes this app
  doesn't need; the "backend" it does need (indexer queries) is
  already a separate process (ADR 0014), not something to fold into a
  frontend framework's server layer.
- **State management library (Redux, Zustand, etc.)** — the app's
  shared state is small and shallow (connected wallet, active chain,
  in-flight transaction) — plain React context is sufficient and
  keeps state fully visible in the component tree rather than behind a
  store abstraction.

## Consequences

- `web/package.json`'s dependency list stays close in spirit to every
  other package's (`ethers` plus the UI framework itself), not a large
  transitive dependency tree from a wallet-connection or component
  library.
- The lineage graph's layout algorithm is bespoke and testable in
  isolation (pure functions from edge/model data to node positions),
  not a black box behind a third-party graph library's API.
- A future maintainer who wants React Flow, wagmi, or Tailwind can
  still add them later without this ADR having built anything
  incompatible with that — nothing here is a one-way door, it's a
  starting-scope decision.
