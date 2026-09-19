# AgentForge release-readiness evidence map

**Checkpoint:** 2026-09-19, America/Chicago  
**Candidate commit:** `33cb9e0` (`docs: add release readiness evidence map`)
**Decision:** Conditionally ready locally; not externally ready until the exact
candidate is deployed and read back.  
**Boundary:** Synthetic-only, read-only, clinician-reviewed. No PHI, live
clinical records, or clinical write-back.

**Owner authorization — 2026-09-19:** David explicitly authorized deployment,
runtime inspection, and verification against the owner-controlled Vultr
synthetic environment. This remains bounded by the project boundary: no PHI,
no live clinical records, no clinical write-back, no provider migration before
the final OpenRouter step, and no demo/submission upload.

## Evidence matrix

| Requirement | Implementation proof | Runtime proof | External proof | Status / smallest next action |
|---|---|---|---|---|
| Core briefing and follow-up workflow | `agentforge/src/`, service and UI tests | `77/77` application/eval/observability tests; `7/7` golden cases | Existing public health/readiness only; dashboard is stale | Partial: deploy `33cb9e0`, then run clean-browser briefing and follow-up. |
| Authorization and PHP launcher seam | `accessContext.js`, PHP launcher, parity test | `2/2` PHP parity/lint tests; PHP 8.4.25 installed | Public runtime has not been checked against this commit | Local complete; refresh exact deployed candidate. |
| Safety boundary | Read-only contracts, verifier, fixture adapter, redaction | Golden safety gate `7/7`; no-PHI synthetic fixtures | No PHI or live-record claim permitted | Complete for synthetic checkpoint. |
| Visual operational dashboard | `agentforge/src/observabilityPage.js`; `/observability` route | Local browser shows cards, latency bars, outcomes, alerts, queue, fallback, traces | Public page still contains the old JSON `<pre>` view | Blocked on deployment: read back the visual page externally. |
| Metrics and alert semantics | `/v1/metrics`, `/v1/alerts`, bounded-window evaluator | Three alert rules render locally; tool-failure alert fires over active synthetic window | Public endpoint exists but page is stale | Partial: verify dashboard and alert state after deployment. |
| Provider lane | Qwen remains configured behind existing provider seam; deterministic fallback retained | Provider tests and current Qwen-compatible local behavior | Current public runtime is healthy; exact candidate/provider identity unverified | Keep Qwen through dashboard verification; OpenRouter is final migration only. |
| Observability redaction | Redacted trace sink and dashboard rendering | Observability tests pass; browser shows metadata only | Public redaction readback remains candidate-scoped | Partial: verify deployed dashboard contains no sensitive content. |
| Submission/demo artifacts | Existing submission/interview docs and user-owned media | Not re-recorded or mutated | No external upload/share performed | Owner-owned final step; do not alter media here. |

## Verification commands

```powershell
node --test agentforge/test/*.test.js evals/test/*.test.js observability/test/*.test.js
node --test scripts/test/*.test.mjs
node evals/lib/runner.js
```

Observed results for `33cb9e0`: `77/77`, `4/4`, and `7/7` passed.

## Current external snapshot

Read-only checks against `https://dtstest.64.177.10.182.nip.io/agentforge`:

- `/health`: 200 / `ok`
- `/ready`: 200 / `ready`
- `/observability`: reachable, but still the old JSON view
- Visual dashboard from `e02495f`: not deployed

No deployment, provider migration, demo upload, submission, or PHI action is
authorized by this checkpoint.

## Release gate

The exact next action is a deployment-owner decision: deploy `e02495f` to the
existing synthetic Vultr target, then read back `/health`, `/ready`, the visual
`/observability` page, the synthetic briefing/follow-up flow, and the three
alert panels. Only after that gate should the final OpenRouter migration be
considered.
