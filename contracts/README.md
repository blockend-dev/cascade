# contracts

Hardhat + TypeScript project. See `docs/adr/0002-repo-layout-and-tooling.md`
for why Hardhat over Foundry in this environment.

```
npm install
npm run build   # compile
npm test        # run the unit/fuzz suite
```

Solidity sources: `src/`. Tests: `test/`.

## Deploy

```
npm run deploy -- --network hardhat   # local/ephemeral, safe, no config needed
npm run deploy -- --network target    # real network — see contracts/.env.example first
```

See [`docs/deployment.md`](../docs/deployment.md) for the full
procedure: deployment order, configuration, verification, the resulting
`contracts/deployments/<network>.json` record, and how the addresses
get supplied to `sdk/`, `relayer/`, `indexer/`, and `web/`.
