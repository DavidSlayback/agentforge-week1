# AgentForge local AFK report

## Run boundary

Local implementation plus user-authorized direct Vultr deployment readback. No push, PR, or merge. GitLab remains the issue/source-of-record. Budget: one active lane, one repair attempt per ticket.

## Completed

- Planning migration: preserved AF-01–AF-15 and upgraded verification requirements to explicit owner sign-off plus reproducible evidence; no independent reviewer is assumed.
- AF-01: approved repository-stored requirements inventory recorded; the original AgentForge brief PDF is not stored in this repository.
- AF-03: verified local multi-turn conversation surface at `c4c96c2`.
- AF-05: verified strict contracts and runnable API collection at `8bf030a`.
- AF-04: verified safety and patient-scope states at `de3430b`.
- AF-02: verified the Railway canonical HTTPS origin `https://agentforge-week1-production.up.railway.app`; route matrix, API collection, and browser interaction passed.
- AF-06: verified the deployed evaluator/operations panel, linked operational routes, saved golden/mutation evidence, and fresh-browser discoverability at the canonical origin.
- AF-07: owner-approved the checkpoint after a fresh-browser briefing/follow-up rehearsal, blocked cross-patient probe, evaluator review, and synthetic-only limitation review.
- AF-08: decision input recorded in GitLab #9 and local ADRs; implementation/runtime evidence is ready for owner sign-off.
- AF-08 foundation: added durable redacted traces, retention/deletion, restart persistence, isolated evaluator-state tests, and a bounded synthetic incident drill with a written response runbook; local checks pass, but the HITL gate remains open.
- AF-08 foundation is deployed on the Railway canonical URL and its public route/API collection checks pass. Railway rollback succeeded, temporarily left no active deployment, and was recovered to the alert-enabled deployment; the live collection then passed.
- Deployed `/v1/alerts` fired `tool_failure_rate` at `0.17142857142857143` after synthetic partial-retrieval traffic. Railway volume `agentforge-week1-volume` is mounted at `/data` with `AGENTFORGE_TRACE_PATH=/data/traces.json`; the sentinel trace survived a confirmed redeploy and the active deployment reported success.
- AF-08 owner sign-off is recorded. Continued locally with AF-09 synthetic server-verified context, AF-10 provider retry/fallback, AF-11 expanded operational dashboard and Windows-safe trace persistence, and AF-12 reproducible load harness.
- Signed synthetic load evidence: 100/100 requests at concurrency 10 and 500/500 at concurrency 50; raw reports are in `.scratch/overnight/evidence/load-10-signed-final.json` and `load-50-signed-final.json`.
- Final package artifacts are `docs/agentforge/FINAL_PACKAGE.md`, `FINAL_INTERVIEW_PREP.md`, `FINAL_SOCIAL_DRAFT.md`, plus AF-13–AF-19 evidence/ticket files. The current candidate `1259fbb` is deployed directly to Vultr at `https://dtstest.64.177.10.182.nip.io/agentforge/`; no push, PR, merge, or publication occurred. The new conversational latency/cache/deadline contract is deployed and measured.
- Authenticated Vultr billing readback now shows $1.36 account charges this month and $28.64 remaining credit. AF-18 is ready for owner projection review; trusted HTTPS is now read back on the `dtstest.64.177.10.182.nip.io` hostname.

## Current frontier

- AF-08 is PASS/VERIFIED. AF-09–AF-12 are locally implemented/measured under the permanent synthetic boundary. AF-16 and AF-17 are ready for owner review; AF-18 remains blocked on billing readback, and AF-19 remains blocked on trusted HTTPS, billing, and final owner readback.

## Evidence policy

Every verified ticket must have `.scratch/overnight/evidence/AF-XX.md` mapping each acceptance criterion to command output and implementation/runtime/external evidence. A passing test alone is not completion.

## AF-03 result

PASS. Local runtime evidence exists; external deployment/browser evidence remains intentionally open under AF-02/AF-07.

## AF-05 result

PASS. Local API collection and readiness-failure evidence exist; deployed canonical-origin evidence remains intentionally open under AF-02/AF-07.

## AF-02 result

PASS externally. Railway trusted HTTPS, route matrix, deployed API collection, and fresh-browser multi-turn/safety interaction passed. The Railway-generated domain is now the canonical evaluator origin for this checkpoint.

## AF-04 result

PASS locally at `de3430b`; local safety-state evidence exists. The next action was the AF-02 external deployment/TLS decision.

## AF-06 result

PASS at `e80ed6d`, externally verified at the Railway canonical origin. The evaluator panel exposes operational routes and saved reports, and the browser route/link walk passed. The next action is the AF-07 external release-verification decision.

## AF-07 result

PASS. Owner sign-off was received after a fresh Chrome Incognito rehearsal at the canonical Railway URL. UI polish is a deferred non-blocking follow-up; no checkpoint behavior was reopened.
