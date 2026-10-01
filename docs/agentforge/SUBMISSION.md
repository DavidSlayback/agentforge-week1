# AgentForge Sunday final-submission package

> **Historical Week 1 checkpoint package.** The deployment, providers, and
> evidence below refer to older candidate `d8b4ba8`, not the current Week 2
> working tree. Do not submit or present this as W2 evidence. See
> the root [`W2_ARCHITECTURE.md`](../../W2_ARCHITECTURE.md) §2 and the
> [`PLAN.md`](PLAN.md) completion record for current W2 status and gaps.

> At the time of that Week 1 checkpoint, candidate evidence was tracked in
> `archive/RELEASE_READINESS.md`; its video status and provider notes are historical.

## Release position

This repository contains a synthetic, read-only, production-shaped AgentForge
 checkpoint. The verified Vultr evidence URL is:

`https://dtstest.64.177.10.182.nip.io/agentforge/`

At that checkpoint the deployed candidate was `d8b4ba8`; Qwen was active for
synthesis and OpenRouter for follow-ups. No external publication occurred.

## What the synthetic checkpoint proves

- A signed synthetic session binds patient, clinician, and `read-briefing`
  scope at the service boundary.
- Fixture-backed retrieval preserves complete, partial, conflict, stale,
  missing-provenance, untrusted-note, and duplicate-identity behavior.
- Verification precedes display and the surface remains read-only.
- The browser supports briefing, follow-up, evidence expansion, qualification,
  reset, and blocked cross-patient probing.
- A configured provider can retry twice and fall back deterministically without
  making provider output an authorization or verification decision.
- Redacted file-backed traces, interaction-specific latency/cache/deadline
  metrics, alerts, retention/deletion,
  backup/restore, rollback, and load evidence are inspectable.

## Verification commands

That checkpoint's candidate-specific evidence is in the requirements matrix
(now a historical snapshot) and `archive/RELEASE_READINESS.md`.

```text
node --test agentforge/test/*.test.js
node --test observability/test/*.test.js
npm --prefix evals test
git diff --check
node scripts/agentforge-load.mjs --base-url <candidate-url> --concurrency 10 --requests 100 --out .scratch/agentforge-load-10-final.json
node scripts/agentforge-load.mjs --base-url <candidate-url> --concurrency 50 --requests 500 --out .scratch/agentforge-load-50-final.json
```

Local results at that checkpoint were 91/91 repository tests plus 4/4 script checks, including the AgentForge,
evaluation, observability, helper, PHP, and provider/load-harness regressions.
The latest bounded split-lane load sample, measured on candidate `56d1a35`, is
10/10 successful at concurrency 10 and 46/50 at concurrency 50; the latter
shows the provider tail-latency boundary. Container sampling peaked at 29.06%
CPU and 52.01 MiB resident memory. Larger workloads are not claimed as passing.

That checkpoint's live API and browser reports are tied to candidate `d8b4ba8`; the
load sample is explicitly tied to `56d1a35` and was not relabeled as a fresh
`d8b4ba8` capacity run.

## Reviewer path

The expanded local workflow and asynchronous open behavior are described in
[`DEMO_SCRIPT.md`](DEMO_SCRIPT.md), including a timed voiceover and recording
sequence. They are included in candidate `d8b4ba8` where applicable.
For the current local demo, use `http://127.0.0.1:18790/`; select a patient, allow
background preparation to finish, then use **Open prepared briefing**. Opening a
fresh result rechecks authorization and cache expiry without another model call.
The deployed path below remains a separate candidate readback.

1. Open `https://dtstest.64.177.10.182.nip.io/agentforge/` in a clean browser.
2. Prepare `fixture-patient-001` and show the synthesized documented change.
3. Ask “What changed since the last visit?” and “What plan items need follow-through?”
   to show two patient-scoped conversation turns.
4. Prepare `fixture-patient-006` and show qualified partial retrieval and
   withheld fields.
5. Run the cross-patient probe and show the blocked response with no disclosure.
6. Open evaluator evidence, health, readiness, metrics, alerts, traces, and
   the observability dashboard.
7. Run the final external API collection and record the deployment version.

## Evidence index

| Area | Evidence |
| --- | --- |
| Requirements and architecture | `docs/agentforge/REQUIREMENTS.md`, `ARCHITECTURE.md`, `DECISIONS.md` |
| Early external checkpoint | `docs/agentforge/archive/HISTORICAL_QUEUE_SUMMARY.md` |
| Authenticated synthetic seam | `docs/agentforge/archive/HISTORICAL_QUEUE_SUMMARY.md` |
| Provider failure policy | `docs/agentforge/archive/HISTORICAL_QUEUE_SUMMARY.md`, `docs/agentforge/RESILIENCE.md` |
| Operations and recovery | `docs/agentforge/archive/HISTORICAL_QUEUE_SUMMARY.md`, `docs/agentforge/RESILIENCE.md` |
| Conversational latency/cache contract | `docs/agentforge/archive/CONVERSATIONAL_AGENT_HANDOFF.md`, commit `1259fbb`, deployed `/v1/metrics` |
| Load and cost boundary | `docs/agentforge/archive/HISTORICAL_QUEUE_SUMMARY.md`, `docs/agentforge/LOAD_TEST.md` |
| Deployed scale (at that checkpoint) | No raw artifact for `d8b4ba8`. Later load runs: `docs/agentforge/LOAD_TEST.md`. |
| Final release checklist | `docs/agentforge/FINAL_PACKAGE.md` |
| Interview defense | `docs/agentforge/FINAL_INTERVIEW_PREP.md` |
| No-publish communication draft | `docs/agentforge/FINAL_SOCIAL_DRAFT.md` |

## Non-claims

This is not live clinical retrieval, PHI processing, HIPAA compliance, a BAA,
clinical safety validation, provider suitability evidence, cross-region
durability, or a production availability/SLO claim. No hosted vendor is
selected. No clinical recommendation, chart write, diagnosis, order,
medication change, or arbitrary OpenEMR action is supported.
