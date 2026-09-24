# 09: Fifty-case regression gate

**Type:** AFK

**What to build:** The full synthetic golden-set evaluation and blocking
regression gate for extraction, retrieval, citations, refusals, missing data,
patient scope, and observability safety.

**Blocked by:**

- 05: Deterministic supervisor workflow
- 06: Redacted observability and evaluation scaffold

**Status:** accepted-with-residual

- [x] The 50-case corpus covers required extraction, retrieval, citation, refusal, missing-data, follow-up, and safety categories.
- [x] Expected behavior, boolean rubrics, an explicit judge configuration, and a reproducible baseline report are checked into the project evidence path.
- [x] The gate requires at least 95% per required rubric and has zero tolerance for no-PHI-in-logs and critical safety failures.
- [x] A regression greater than five percentage points fails the gate.
- [x] An injected defect demonstrably blocks the change rather than merely reporting a warning.
- [x] The gate runs from a documented command invoked by versioned CI and produces reviewer-visible results without raw document content.

**Evidence:** `agentforge/src/w2RegressionGate.js`, `agentforge/test/w2-regression-gate.test.js`, `agentforge/scripts/run-w2-gate.mjs`, `docs/agentforge/W2_EVAL_GATE.md`, `docs/agentforge/evidence/W2_BASELINE_REPORT.json`, and `.github/workflows/agentforge-w2-gate.yml`.

**Verification:** `npm test --prefix agentforge` passes 94/94; `npm run eval:gate --prefix agentforge` passes 50/50; the injected-defect invocation exits 1 with a 12.5 percentage-point extraction regression.

**Residual:** Hosted CI execution/readback and the deployed reviewer path remain unverified until a branch/PR run exists. The corpus is generated deterministically from the checked-in case sequence rather than stored as 50 separate JSON objects.
