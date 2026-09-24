# 06: Redacted observability and evaluation scaffold

**Type:** AFK

**What to build:** Reviewer-visible redacted traces and the initial evaluation
scaffold for the integrated evidence-triage workflow, so quality, safety, cost,
and latency can be measured before the early checkpoint.

**Blocked by:** 05: Deterministic supervisor workflow

**Status:** accepted-with-residual

- [x] The existing encounter trace records tool sequence, per-step latency, token usage, estimated cost, retrieval hits, extraction status/confidence, and evaluation outcome fields.
- [x] Redaction tests prove that raw document content, prompts, extracted fields, quotes, images, screenshots, and patient scope do not reach the observability surface.
- [x] The scaffold supports labeled extraction, retrieval, citation, refusal, missing-data, and follow-up cases.
- [x] Evaluation results are reproducible from synthetic cases and label the result as synthetic-only.
- [x] A reviewer can inspect a trace without receiving raw synthetic document contents.

## Verification

- Full AgentForge suite: `86/86`.
- Residuals: extraction/evaluation fields are scaffolded into the main briefing trace; the new evidence/supervisor endpoints do not yet emit dedicated traces, and no deployment/runtime evidence is claimed.
