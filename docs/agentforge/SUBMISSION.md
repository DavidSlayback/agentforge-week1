# AgentForge Sunday final-submission package

## Release position

This repository contains the final-candidate path for a synthetic, read-only,
production-shaped AgentForge checkpoint. The current deployed Vultr evidence
URL is:

`http://64.177.10.182/agentforge/`

The Railway deployment is prior checkpoint evidence. The current local changes
were deployed directly to Vultr at commit `dcdae5b`; the current route is HTTP
with Caddy internal/self-signed TLS, so trusted HTTPS release remains open.
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
- Redacted file-backed traces, metrics, alerts, retention/deletion,
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

The current results are 20/20 AgentForge tests, 9/9 observability tests, 10/10
eval tests, zero deployed load errors, 100/100 at concurrency 10, and 500/500
at concurrency 50 in signed synthetic mode.

## Reviewer path

1. Open `http://64.177.10.182/agentforge/` in a clean browser; trusted HTTPS is
   not yet available on this candidate.
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
| Load and cost boundary | `.scratch/overnight/evidence/AF-12.md`, `docs/agentforge/LOAD_TEST.md` |
| Current deployed scale | `.scratch/overnight/evidence/AF-17.md`, `.scratch/overnight/evidence/load-deployed-10.json`, `.scratch/overnight/evidence/load-deployed-50.json` |
| Final release checklist | `docs/agentforge/FINAL_PACKAGE.md` |
| Interview defense | `docs/agentforge/FINAL_INTERVIEW_PREP.md` |
| No-publish communication draft | `docs/agentforge/FINAL_SOCIAL_DRAFT.md` |

## Non-claims

This is not live clinical retrieval, PHI processing, HIPAA compliance, a BAA,
clinical safety validation, provider suitability evidence, cross-region
durability, or a production availability/SLO claim. No hosted vendor is
selected. No clinical recommendation, chart write, diagnosis, order,
medication change, or arbitrary OpenEMR action is supported.
