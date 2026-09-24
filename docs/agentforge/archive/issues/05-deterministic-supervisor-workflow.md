# 05: Deterministic supervisor workflow

**Type:** AFK

**What to build:** The inspectable end-to-end evidence-triage workflow with an
explicit supervisor state graph, intake extractor, evidence retriever, worker
handoffs, readiness checks, and deterministic verification.

**Blocked by:**

- 02: Lab PDF evidence slice
- 03: Intake form evidence slice
- 04: Grounded follow-up retrieval

**Status:** accepted-with-residual

- [x] The supervisor routes work through explicit named states and logs each worker handoff.
- [x] The intake extractor and evidence retriever receive typed inputs and return typed outputs under the shared evidence contract.
- [x] The workflow distinguishes ready, qualified, incomplete, conflicting, and unsafe evidence states and stops or asks for clarification.
- [x] Deterministic verification rejects uncited, unsupported, and unsafe evidence before readiness; patient scope is enforced by the upstream service boundary.
- [ ] A synthetic physician can complete the full browser journey from documents to a qualified grounded follow-up.
- [x] State transitions, handoffs, stop conditions, and final readiness have contract and integration coverage.

## Verification

- Full AgentForge suite: `84/84`.
- Synthetic supervisor API exposes explicit transitions and handoffs.
- Residual: browser end-to-end integration and full document-to-supervisor orchestration remain open.
