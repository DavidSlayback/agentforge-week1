# AgentForge Sunday final-submission package

> Historical package snapshot. Current implementation publication and review
> status are tracked in `WAYFINDER_MAP.md`, `HANDOFF.md`, and the private GitLab
> staging issues/MRs; statements below about no publication or older candidate
> commits are retained as historical context.

## Release position

This repository contains a synthetic, read-only, production-shaped AgentForge
checkpoint. The historical Vultr evidence URL is:

`https://dtstest.64.177.10.182.nip.io/agentforge/`

The Railway deployment is prior checkpoint evidence. The local B authorization
changes are newer than the Vultr deployment and have not been redeployed. The
historical hostname used Caddy-managed trusted HTTPS, with HTTP redirect
readback; it is not current-candidate proof.
No push, PR, merge, or publication occurred.

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

This submission artifact is historical. Raw queue evidence paths were retired;
use the current requirements matrix and fresh candidate-specific evidence for
any new release claim.

```text
node --test agentforge/test/*.test.js
node --test observability/test/*.test.js
npm --prefix evals test
git diff --check
node scripts/agentforge-load.mjs --base-url <candidate-url> --concurrency 10 --requests 100 --out .scratch/agentforge-load-10-final.json
node scripts/agentforge-load.mjs --base-url <candidate-url> --concurrency 50 --requests 500 --out .scratch/agentforge-load-50-final.json
```

The historical local results were 25/25 AgentForge tests, 10/10 observability tests, 10/10
eval tests, zero deployed load errors, 100/100 at concurrency 10, and 500/500
at concurrency 50 in signed synthetic mode. The former deployed reports were
retired with the historical queue and are not current-candidate release proof.

The deployed load and browser reports are candidate snapshots tied to
`1259fbb`/`c3a63a3`; the active local branch is `f969227`. Do not present those
reports as current-branch release proof until the canonical candidate decision
is closed.

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
