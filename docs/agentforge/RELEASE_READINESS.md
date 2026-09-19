# AgentForge release-readiness evidence map

**Checkpoint:** 2026-09-19, America/Chicago  
**Candidate commit:** `e68c43c` (`feat: add dormant OpenRouter provider mode`)
**Decision:** Conditionally ready for the synthetic checkpoint; the exact
candidate is now deployed and read back, with the remaining load and packaging
limitations recorded below.  
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
| Core briefing and follow-up workflow | `agentforge/src/`, service and UI tests | `78/78` application/eval/observability tests; `7/7` golden cases | Public collection and browser dashboard readback pass | Done for synthetic checkpoint; provider latency remains a capacity concern. |
| Authorization and PHP launcher seam | `accessContext.js`, PHP launcher, parity test | `2/2` PHP parity/lint tests; PHP 8.4.25 installed | Public runtime has not been checked against this commit | Local complete; refresh exact deployed candidate. |
| Safety boundary | Read-only contracts, verifier, fixture adapter, redaction | Golden safety gate `7/7`; no-PHI synthetic fixtures | No PHI or live-record claim permitted | Complete for synthetic checkpoint. |
| Visual operational dashboard | `agentforge/src/observabilityPage.js`; `/observability` route | Local browser shows cards, latency bars, outcomes, alerts, queue, fallback, traces | Public browser shows the same visual dashboard and redacted trace panels | Done for synthetic checkpoint. |
| Metrics and alert semantics | `/v1/metrics`, `/v1/alerts`, bounded-window evaluator | Three alert rules render locally; tool-failure alert fires over active synthetic window | Public endpoint exists but page is stale | Partial: verify dashboard and alert state after deployment. |
| Provider lane | Qwen remains active behind the provider seam; dormant OpenRouter mode is configured server-side; deterministic fallback retained | Provider tests and current Qwen-compatible local behavior | Current public runtime is healthy; OpenRouter is not called | Keep Qwen through submission evidence; switch to OpenRouter only in the final authorized migration step. |
| Observability redaction | Redacted trace sink and dashboard rendering | Observability tests pass; browser shows metadata only | Public redaction readback remains candidate-scoped | Partial: verify deployed dashboard contains no sensitive content. |
| Submission/demo artifacts | Existing submission/interview docs and user-owned media | Not re-recorded or mutated | No external upload/share performed | Owner-owned final step; do not alter media here. |

## Verification commands

```powershell
node --test agentforge/test/*.test.js evals/test/*.test.js observability/test/*.test.js
node --test scripts/test/*.test.mjs
node evals/lib/runner.js
```

Observed results for `b9f287a`: `78/78`, `4/4`, and `7/7` passed; helper/PHP/provider tests remain `4/4`.

## Current external snapshot

Read-only checks against `https://dtstest.64.177.10.182.nip.io/agentforge`:

- `/health`: 200 / `ok`
- `/ready`: 200 / `ready`
- `/observability`: 200, visual dashboard read back in a clean browser
- Visual dashboard from `b9f287a`: deployed and verified below

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

## Current candidate refresh — 2026-09-19

The cleanup candidate `b9f287a` was rebuilt and redeployed. The current
AgentForge image is healthy with digest
`sha256:921302382891b2a9c63ac21ac269b32abe4f4f567ddd594c329d1cc9eabcd99e`.
The public API collection passed again with complete and partial briefings,
follow-up, blocked authorization and cross-patient cases, invalid request,
metrics, traces, alerts, and observability.

Bounded public Qwen load observations using the current candidate:

- 10 concurrent / 10 requests: 10/10 successful, 0% errors, p50 12.2s,
  p95/p99 26.1s, 0.383 requests/second.
- 50 concurrent / 50 requests: 47/50 successful, 6% client timeout errors,
  p50 29.1s, p95/p99 45.0s, 1.111 requests/second.

The assignment's larger 100-request and 500-request workloads are not claimed
as passing: the 10-concurrent run was stopped after the Qwen lane exceeded a
practical runtime budget, and the 50-concurrent smoke run exposed the same
tail-latency/capacity issue. The load harness now has a bounded client timeout
so this failure mode is reproducible rather than a hanging process.

The provider configuration now includes a dormant OpenRouter lane. The public
runtime remains on `AGENTFORGE_PROVIDER_MODE=qwen`; the OpenRouter credential is
stored only in the server-side `.env` and was not exercised during verification.

## Final candidate readback — 2026-09-19

Commit `e68c43c` was archived to `/opt/agentforge-week1` and rebuilt on Vultr.
The deployed AgentForge image is `sha256:80f1a690aa6bc8ccd9ee46c307095e0d589b6003a0e1eb48c605375a04037723`;
the container reports healthy. Public readback passed `/health`, `/ready`,
`/observability`, `/v1/metrics`, `/v1/traces`, and `/v1/alerts` with HTTP 200.
The full API collection also passed complete and partial briefing, follow-up,
blocked authorization and cross-patient cases, invalid request rejection, and
all observability routes. The active provider mode read back as Qwen; the
OpenRouter key was present only as a redacted server-side environment value.

## Release gate

The deployment/readback gate is complete for this synthetic checkpoint. The
remaining release decision is owner-controlled packaging/submission work, the
provider-capacity fix or explicit acceptance of the Qwen latency, and at the
very end the separately requested OpenRouter provider migration.
