# 10: Early checkpoint package

**Type:** HITL

**What to build:** One indivisible early-submission package containing the
working deployed synthetic flow, reviewer-visible evaluation scaffold,
redacted observability, and the evidence needed for the user to run the demo.

**Blocked by:**

- 05: Deterministic supervisor workflow
- 06: Redacted observability and evaluation scaffold

**Status:** accepted-with-residual

- [ ] The deployed synthetic application supports both document types through the evidence-triage workflow.
- [ ] A clean-browser path demonstrates upload, extraction, source citation, grounded follow-up, and qualified uncertainty.
- [x] Reviewer-visible traces and the evaluation scaffold are available without raw document content.
- [x] Setup and run instructions identify the exact service, configuration, and synthetic fixtures without calendar assumptions.
- [ ] The package includes a concise demo runbook and a verified 3–5 minute recording/link showing upload, extraction, retrieval, citations, eval results, and observability; the user owns executing and presenting the demo.
- [x] Deployment and any public access occur only with explicit external release authority; no current-candidate deployment or public sharing was attempted.

**Evidence:** `docs/agentforge/W2_EARLY_CHECKPOINT.md`, `agentforge/test/evaluator-surface.test.js`, the local browser readback of `/`, `/evals`, and `/observability`, and the W2 gate artifacts.

**Residual:** Current-candidate deployment/public URL, browser file-selection/upload proof, and the owner-recorded 3–5 minute demo remain `NEEDS_HUMAN`/`INCONCLUSIVE`. Prior deployment evidence is candidate-scoped and cannot be reused for this revision.
