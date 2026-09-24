# AgentForge release-readiness evidence map

> **Historical Week 1 release record.** Candidate `d8b4ba8` and all runtime
> measurements below describe the September 21 synthetic checkpoint. They do
> not prove the current Week 2 working tree is deployed or ready. Use
> [`W2_EARLY_CHECKPOINT.md`](W2_EARLY_CHECKPOINT.md) for current W2 evidence.

**Checkpoint:** 2026-09-21, America/Chicago
**Candidate commit:** `d8b4ba8` (`docs: normalize deployment evidence formatting`)
**Decision:** Conditionally ready for the synthetic checkpoint; the exact
candidate is now deployed and read back, with the remaining load and packaging
limitations recorded below.  
**Boundary:** Synthetic-only, read-only, clinician-reviewed. No PHI, live
clinical records, or clinical write-back.

**Owner authorization — 2026-09-19:** David explicitly authorized deployment,
runtime inspection, and verification against the owner-controlled Vultr
synthetic environment. This remains bounded by the project boundary: no PHI,
no live clinical records, no clinical write-back, and no demo/submission upload.

## Evidence matrix

| Requirement | Implementation proof | Runtime proof | External proof | Status / smallest next action |
|---|---|---|---|---|
| Core briefing and follow-up workflow | `agentforge/src/`, service and UI tests | `91/91` repository tests plus `4/4` script checks; `9/9` local golden cases | Current candidate API collection passes complete/partial briefing, follow-up, blocked scope, invalid request, metrics, traces, alerts, and observability | Done for the exercised synthetic checkpoint; Qwen tail latency is accepted for asynchronous preparation and is not an interactive follow-up SLA. |
| Authorization and PHP launcher seam | `accessContext.js`, PHP launcher, parity test | `2/2` PHP parity/lint tests; PHP 8.4.25 installed | Current public runtime is healthy; exact PHP parity remains local evidence | Local complete; production identity equivalence remains out of scope. |
| Safety boundary | Read-only contracts, verifier, fixture adapter, redaction | Local golden safety gate `9/9`; no-PHI synthetic fixtures | Current public collection passes blocked authorization and cross-patient probes | Complete for the synthetic/read-only boundary; no PHI or live-record claim permitted. |
| Visual operational dashboard | `agentforge/src/observabilityPage.js`; `/observability` route | Local browser shows cards, latency bars, outcomes, alerts, queue, fallback, traces | Public browser shows the same visual dashboard and redacted trace panels | Done for synthetic checkpoint. |
| Metrics and alert semantics | `/v1/metrics`, `/v1/alerts`, bounded-window evaluator | Three alert rules render locally; tool-failure alert fires over active synthetic window | Public endpoint and dashboard readback pass | Done for synthetic checkpoint; external notification ownership remains open. |
| Provider lane | Qwen synthesis plus OpenRouter Gemini Flash-Lite follow-up; deterministic fallback retained | Provider tests and live trace readback | Current public runtime is healthy; both primary lanes were observed | Keep the split lanes through submission. |
| Observability redaction | Redacted trace sink and dashboard rendering | Observability tests pass; browser shows metadata only | Public redaction readback remains candidate-scoped | Partial: verify deployed dashboard contains no sensitive content. |
| Submission/demo artifacts | Existing submission/interview docs and user-owned media | Not re-recorded or mutated | No external upload/share performed | Owner-owned final step; do not alter media here. |

## Verification commands

```powershell
node --test agentforge/test/*.test.js evals/test/*.test.js observability/test/*.test.js
node --test scripts/test/*.test.mjs
node evals/lib/runner.js
```

Observed local results are `91/91` repository tests plus `4/4` script checks. The latest split-lane load sample is separately tied to candidate `56d1a35`; it remains historical capacity evidence.

## Current external snapshot

Read-only checks against `https://dtstest.64.177.10.182.nip.io/agentforge`:

- `/health`: 200 / `ok`
- `/ready`: 200 / `ready`
- `/observability`: 200, visual dashboard read back in a clean browser
- Visual dashboard from current candidate `d8b4ba8`: deployed and verified below

Before the owner authorization recorded above, no deployment, provider
migration, demo upload, submission, or PHI action was authorized by this
checkpoint.

## Authorized deployment readback — 2026-09-21

The owner-authorized synthetic Vultr target was rebuilt from GitLab `main`
candidate `d8b4ba8`. The AgentForge container started at
`2026-09-21T18:51:50.935703093Z`, reported `healthy`, and ran image
`sha256:519eb1b737dd46b92fa743dff9c22215cf4366b43cc516e2935489c129417c33`.
The deployed hashes for `service.js`, `modelProvider.js`, and `server.js`
matched the local checkout. External readback at approximately 18:52 UTC
returned HTTP 308 for HTTP-to-HTTPS, then 200 for `/health`, `/ready`, and
`/observability`; the API collection passed complete/partial briefing,
follow-up, blocked-scope, invalid-request, metrics, traces, and alerts.

## Historical deployment readback — 2026-09-19

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

## Latest split-lane load sample — 2026-09-19

The latest recorded split-lane load sample was measured on candidate
`56d1a35`. The public API collection passed with complete and partial briefings,
follow-up, blocked authorization and cross-patient cases, invalid request,
metrics, traces, alerts, and observability.

Bounded public load observations using candidate `56d1a35`:

- 10 concurrent / 10 requests: 10/10 successful, 0% errors, p50 27.6s,
  p95/p99 43.4s, 0.231 requests/second.
- 50 concurrent / 50 requests: 46/50 successful, 8% client timeout errors,
  p50 30.19s, p95/p99 45.0s, 1.111 requests/second.
- Resource sample across both runs: AgentForge container peak CPU 29.06% and
  peak memory 52.01 MiB (about 1.36% of the 3.818 GiB limit).

The assignment's larger 100-request and 500-request workloads are not claimed
as passing: the 10-concurrent run was stopped after the Qwen lane exceeded a
practical runtime budget, and the 50-concurrent smoke run exposed the same
tail-latency/capacity issue. The load harness now has a bounded client timeout
so this failure mode is reproducible rather than a hanging process.

The later split-lane sample is recorded in `LOAD_TEST.md` and is tied to
candidate `56d1a35`; the final deployed candidate is `88420c1`.

## Final candidate readback — 2026-09-19

Commit `88420c1` was archived to `/opt/agentforge-week1` and rebuilt on Vultr.
The live service readback is the authoritative deployment evidence for this candidate;
the container reports healthy. Public readback passed `/health`, `/ready`,
`/observability`, `/v1/metrics`, `/v1/traces`, and `/v1/alerts` with HTTP 200.
The full API collection also passed complete and partial briefing, follow-up,
blocked authorization and cross-patient cases, invalid request rejection, and
all observability routes. The active provider mode read back as Qwen; the
OpenRouter key was present only as a redacted server-side environment value.

## Release gate

The deployment/readback gate is complete for this synthetic checkpoint. The
remaining release decision is owner-controlled packaging/submission work and
explicit acceptance of the measured provider tail latency. The split provider
configuration is already exercised on synthetic data; no PHI or external
publication is in scope.
