# Week 2 retrieval benchmark

Date: 2026-09-22
Version: `w2-retrieval-benchmark-v1`
Corpus: three synthetic guideline queries, including an unsupported query.

## Observed local resul

| Path | Relevant/qualified cases | Citation preservation | p50 latency | p95 latency | Estimated cost |
|---|---:|---:|---:|---:|---:|
| Deterministic sparse + dense-proxy index | 3/3 | 3/3 | 0.035 ms | 0.255 ms | $0 |
| True provider vector candidate | not executed | not executed | not measured | not measured | not measured |

The unsupported query returned `qualified` with no evidence. Relevant queries
returned the expected synthetic guideline source and location metadata. The
replay fingerprint and raw rows are in
`docs/agentforge/evidence/W2_RETRIEVAL_BENCHMARK.json`.

## Decision

Retain the deterministic index for the local checkpoint. It is reproducible,
zero-cost, citation-preserving, and sufficient for this bounded synthetic
corpus. The `dense_score` field remains explicitly a proxy, not an embedding.
A true vector/provider comparison is `INCONCLUSIVE` because provider/data
processing authority and a representative corpus are not available.
