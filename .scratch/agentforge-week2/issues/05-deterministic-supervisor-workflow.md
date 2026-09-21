# 05: Deterministic supervisor workflow

**Type:** AFK

**What to build:** The inspectable end-to-end evidence-triage workflow with an
explicit supervisor state graph, intake extractor, evidence retriever, worker
handoffs, readiness checks, and deterministic verification.

**Blocked by:**

- 02: Lab PDF evidence slice
- 03: Intake form evidence slice
- 04: Grounded follow-up retrieval

**Status:** ready-for-agent

- [ ] The supervisor routes work through explicit named states and logs each worker handoff.
- [ ] The intake extractor and evidence retriever receive typed inputs and return typed outputs under the shared evidence contract.
- [ ] The workflow knows when evidence is sufficient, incomplete, conflicting, or unsafe and stops or asks for clarification accordingly.
- [ ] Deterministic verification rejects uncited, cross-patient, unsupported, and unsafe results before display.
- [ ] A synthetic physician can complete the browser journey from documents to a qualified grounded follow-up.
- [ ] State transitions, handoffs, stop conditions, and final readiness have contract and integration coverage.
