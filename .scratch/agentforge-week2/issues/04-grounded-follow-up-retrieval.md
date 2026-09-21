# 04: Grounded follow-up retrieval

**Type:** AFK

**What to build:** A clinician follow-up path that separates patient-record
facts from guideline evidence, retrieves and reranks a small provenance-tracked
corpus, and returns only source-grounded evidence with qualified uncertainty.

**Blocked by:**

- 02: Lab PDF evidence slice
- 03: Intake form evidence slice

**Status:** ready-for-agent

- [ ] A follow-up question can retrieve candidate guideline evidence using sparse and dense signals.
- [ ] Reranking returns source metadata and excludes unsupported or irrelevant evidence from the answer context.
- [ ] The response distinguishes synthetic patient facts from external/guideline evidence.
- [ ] Every clinical claim in the response has machine-readable citation metadata and a usable source location.
- [ ] Missing, conflicting, or insufficient evidence produces a qualified answer or clarification request.
- [ ] Retrieval, reranking, citation, and refusal cases have deterministic tests with corpus provenance.
