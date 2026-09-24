# 04: Grounded follow-up retrieval

**Type:** AFK

**What to build:** A clinician follow-up path that separates patient-record
facts from guideline evidence, retrieves and reranks a small provenance-tracked
corpus, and returns only source-grounded evidence with qualified uncertainty.

**Blocked by:**

- 02: Lab PDF evidence slice
- 03: Intake form evidence slice

**Status:** accepted-with-residual

- [x] A follow-up evidence request retrieves candidate synthetic guideline evidence using deterministic sparse and dense-proxy signals.
- [x] Reranking returns corpus source metadata and excludes zero-overlap evidence from the answer context.
- [x] The response distinguishes synthetic patient facts from guideline evidence.
- [x] Guideline evidence has machine-readable source, version, section, quote, and synthetic location metadata.
- [x] Missing or insufficient guideline evidence produces a qualified result; unavailable patient groups are also surfaced.
- [x] Retrieval, reranking, citation, and refusal cases have deterministic tests with corpus provenance.

## Verification

- Full AgentForge suite: `81/81`.
- Synthetic API: patient-scoped chart facts and guideline evidence are returned in separate collections.
- Residuals: production retrieval index, true dense embeddings, model answer integration, and browser evidence display remain open.
