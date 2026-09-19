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

Before the owner authorization recorded above, no deployment, provider
migration, demo upload, submission, or PHI action was authorized by this
checkpoint.

## Authorized deployment readback — 2026-09-19

Owner authorization was exercised for the synthetic Vultr target. Commit
`6fd69eb` was archived to `/opt/agentforge-week1` without overwriting the
server-side `.env`, and the AgentForge image rebuilt successfully. The deployed
image identity was `sha256:4649a2635617acb33cfc605cd60e8fa35c20e3ee8d4c18c2c77b52326aff6e16`
and the container health state was `healthy` at `2026-09-19T22:58:16Z`.

Public readback at
`https://dtstest.64.177.10.182.nip.io/agentforge/` passed at approximately
`2026-09-19T22:59Z`: HTTP redirected to HTTPS with `308`; `/health` and
`/ready` returned `200`; all four readiness dependencies were `ready`; and the
visual `/observability` page rendered in a clean browser with metric cards,
latency bars, safety/outcome panels, provider fallback, three alert panels,
and redacted traces. Source-file blob hashes for the deployed dashboard and
server matched the committed tree after normalizing the local Windows line
endings.

The external API collection passed: complete briefing, qualified partial
briefing, follow-up continuity, blocked authorization, blocked cross-patient
follow-up, invalid request rejection, metrics, traces, alerts, and
observability. The run returned `briefing=complete`, `partial=partial`,
`denied=blocked`, `cross_patient=blocked`, and `invalid_request=400`.
The runtime remained synthetic-only and on the existing Qwen lane; no PHI,
provider migration, clinical write-back, demo upload, or submission action was
performed.

## Release gate

The deployment/readback gate is complete for this synthetic checkpoint. The
remaining release decision is owner-controlled packaging/submission work and,
at the very end, the separately requested OpenRouter provider migration.
