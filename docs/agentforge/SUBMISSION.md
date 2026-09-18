# AgentForge Sunday final-submission package

## Release position

This repository contains the final-candidate path for a synthetic, read-only,
production-shaped AgentForge checkpoint. The current deployed Vultr evidence
URL is:

`https://dts-agentforge.64.177.10.182.nip.io/agentforge/`

The Railway deployment is prior checkpoint evidence. The current local changes
were deployed directly to Vultr at commit `1259fbb`; the current hostname uses
Caddy-managed trusted HTTPS, with HTTP redirect readback.
No push, PR, merge, or publication occurred.

## What the final candidate proves

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

```text
node --test agentforge/test/*.test.js
node --test observability/test/*.test.js
npm --prefix evals test
git diff --check
node scripts/agentforge-load.mjs --base-url <candidate-url> --concurrency 10 --requests 100 --out .scratch/overnight/evidence/load-10-final.json
node scripts/agentforge-load.mjs --base-url <candidate-url> --concurrency 50 --requests 500 --out .scratch/overnight/evidence/load-50-final.json
```

The current results are 24/24 AgentForge tests, 10/10 observability tests, 10/10
eval tests, zero deployed load errors, 100/100 at concurrency 10, and 500/500
at concurrency 50 in signed synthetic mode. The deployed reports are
`.scratch/overnight/evidence/load-deployed-next-10.json` and
`.scratch/overnight/evidence/load-deployed-next-50.json`.

## Reviewer path

1. Open `https://dts-agentforge.64.177.10.182.nip.io/agentforge/` in a clean browser.
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
| Early external checkpoint | `.scratch/overnight/evidence/AF-07.md`, `AF-08.md` |
| Authenticated synthetic seam | `.scratch/overnight/evidence/AF-09.md` |
| Provider failure policy | `.scratch/overnight/evidence/AF-10.md` |
| Operations and recovery | `.scratch/overnight/evidence/AF-11.md`, `docs/agentforge/RESILIENCE.md` |
| Conversational latency/cache contract | `docs/agentforge/CONVERSATIONAL_AGENT_HANDOFF.md`, commit `1259fbb`, deployed `/v1/metrics` |
| Load and cost boundary | `.scratch/overnight/evidence/AF-12.md`, `docs/agentforge/LOAD_TEST.md` |
| Current deployed scale | `.scratch/overnight/evidence/AF-17.md`, `.scratch/overnight/evidence/load-deployed-next-10.json`, `.scratch/overnight/evidence/load-deployed-next-50.json` |
| Final release checklist | `docs/agentforge/FINAL_PACKAGE.md` |
| Interview defense | `docs/agentforge/FINAL_INTERVIEW_PREP.md` |
| No-publish communication draft | `docs/agentforge/FINAL_SOCIAL_DRAFT.md` |

## Non-claims

This is not live clinical retrieval, PHI processing, HIPAA compliance, a BAA,
clinical safety validation, provider suitability evidence, cross-region
durability, or a production availability/SLO claim. No hosted vendor is
selected. No clinical recommendation, chart write, diagnosis, order,
medication change, or arbitrary OpenEMR action is supported.
