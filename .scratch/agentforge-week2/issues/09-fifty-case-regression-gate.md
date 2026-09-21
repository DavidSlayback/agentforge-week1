# 09: Fifty-case regression gate

**Type:** AFK

**What to build:** The full synthetic golden-set evaluation and blocking
regression gate for extraction, retrieval, citations, refusals, missing data,
patient scope, and observability safety.

**Blocked by:**

- 05: Deterministic supervisor workflow
- 06: Redacted observability and evaluation scaffold

**Status:** ready-for-agent

- [ ] The 50-case corpus covers required extraction, retrieval, citation, refusal, missing-data, follow-up, and safety categories.
- [ ] Boolean rubrics and a reproducible baseline report are checked into the project evidence path.
- [ ] The gate requires at least 95% per required rubric and has zero tolerance for no-PHI-in-logs and critical safety failures.
- [ ] A regression greater than five percentage points fails the gate.
- [ ] An injected defect demonstrably blocks the change rather than merely reporting a warning.
- [ ] The gate runs from a documented command and produces reviewer-visible results without raw document content.
