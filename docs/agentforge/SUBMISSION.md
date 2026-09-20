# AgentForge Sunday final-submission package

> Current synthetic checkpoint package. Candidate evidence is tracked in
> `RELEASE_READINESS.md` and `REQUIREMENTS_MATRIX.md`; the video is the only
> intentionally unfinished artifact and OpenRouter remains dormant.

## Release position

This repository contains a synthetic, read-only, production-shaped AgentForge
 checkpoint. The verified Vultr evidence URL is:

`https://dtstest.64.177.10.182.nip.io/agentforge/`

The current deployed candidate is `8203ca6`; Qwen is active and OpenRouter was
not called. No external publication occurred.

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

Use the current requirements matrix and release-readiness record for
candidate-specific evidence.

```text
node --test agentforge/test/*.test.js
node --test observability/test/*.test.js
npm --prefix evals test
git diff --check
node scripts/agentforge-load.mjs --base-url <candidate-url> --concurrency 10 --requests 100 --out .scratch/agentforge-load-10-final.json
node scripts/agentforge-load.mjs --base-url <candidate-url> --concurrency 50 --requests 500 --out .scratch/agentforge-load-50-final.json
```

Current local results are 80/80 application/eval/observability tests, 4/4
helper/PHP tests, and 7/7 golden cases. Current bounded Qwen smoke evidence is
10/10 successful at concurrency 10 and 42/50 at concurrency 50; the latter
shows the Qwen tail-latency boundary. Container sampling peaked at 9.33% CPU
and 1.17% memory. Larger workloads are not claimed as passing.

The current deployed load and browser reports are tied to candidate `8203ca6`.

## Reviewer path

1. Open `https://dtstest.64.177.10.182.nip.io/agentforge/` in a clean browser.
2. Prepare `fixture-patient-001` and show the first assistant turn.
3. Ask “What changed since the last visit?” and show the second turn.
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
| Early external checkpoint | `docs/agentforge/HISTORICAL_QUEUE_SUMMARY.md` |
| Authenticated synthetic seam | `docs/agentforge/HISTORICAL_QUEUE_SUMMARY.md` |
| Provider failure policy | `docs/agentforge/HISTORICAL_QUEUE_SUMMARY.md`, `docs/agentforge/RESILIENCE.md` |
| Operations and recovery | `docs/agentforge/HISTORICAL_QUEUE_SUMMARY.md`, `docs/agentforge/RESILIENCE.md` |
| Conversational latency/cache contract | `docs/agentforge/CONVERSATIONAL_AGENT_HANDOFF.md`, commit `1259fbb`, deployed `/v1/metrics` |
| Load and cost boundary | `docs/agentforge/HISTORICAL_QUEUE_SUMMARY.md`, `docs/agentforge/LOAD_TEST.md` |
| Current deployed scale | No current raw artifact; obtain fresh candidate-specific evidence. |
| Final release checklist | `docs/agentforge/FINAL_PACKAGE.md` |
| Interview defense | `docs/agentforge/FINAL_INTERVIEW_PREP.md` |
| No-publish communication draft | `docs/agentforge/FINAL_SOCIAL_DRAFT.md` |

## Non-claims

This is not live clinical retrieval, PHI processing, HIPAA compliance, a BAA,
clinical safety validation, provider suitability evidence, cross-region
durability, or a production availability/SLO claim. No hosted vendor is
selected. No clinical recommendation, chart write, diagnosis, order,
medication change, or arbitrary OpenEMR action is supported.
