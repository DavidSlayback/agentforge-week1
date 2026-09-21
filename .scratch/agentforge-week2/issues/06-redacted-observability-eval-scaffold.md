# 06: Redacted observability and evaluation scaffold

**Type:** AFK

**What to build:** Reviewer-visible redacted traces and the initial evaluation
scaffold for the integrated evidence-triage workflow, so quality, safety, cost,
and latency can be measured before the early checkpoint.

**Blocked by:** 05: Deterministic supervisor workflow

**Status:** ready-for-agent

- [ ] Each encounter records tool sequence, per-step latency, token usage, estimated cost, retrieval hits, extraction confidence, and evaluation outcome.
- [ ] Redaction tests prove that raw document content, prompts, extracted fields, images, screenshots, and PHI do not reach unsafe observability surfaces.
- [ ] The scaffold supports labeled extraction, retrieval, citation, refusal, missing-data, and follow-up cases.
- [ ] Evaluation results are reproducible from synthetic fixtures and distinguish implementation, runtime, and external evidence.
- [ ] A reviewer can inspect a trace without receiving raw synthetic document contents.
