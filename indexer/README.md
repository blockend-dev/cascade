# indexer — Phase 9 (not yet implemented)

Off-chain DAG resolution and settlement-builder service. Reads finalized
lineage edges from `LineageRegistry`, resolves per-model ancestor splits
(weakest-link confidence, INV-6), and produces the compact settlement
submissions `AttributionSettlement` verifies on-chain per epoch. Full graph
traversal happens here, deliberately never on-chain — see
`docs/protocol-spec.md` §3–4.
