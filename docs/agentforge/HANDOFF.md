# AgentForge assignment rebaseline handoff

- Goal: Re-anchor AgentForge to the original Week 1 assignment, remove stale or conflicting project information, produce a plain-English account of what exists and what remains, then rebuild the implementation plan and ticket queue from current evidence.
- Scope and explicit exclusions: This handoff covers repository cleanup, requirements reconciliation, documentation, architecture/user-story/plan rebaselining, ticket repair, and subsequent assignment work. Preserve the synthetic-only, read-only, clinician-reviewed boundary unless a later explicit decision changes it. Do not load PHI, enable clinical write-back, merge, publish, or send external communications without separate authorization.
- Last verified at: 2026-09-19, America/Chicago.
- Current mechanism: AgentForge is a separate Node service and OpenEMR-facing demonstration surface with a GET-only OpenEMR REST adapter, seeded synthetic read-only E2E retrieval on Vultr, fixture-backed local regression paths, deterministic evaluation, patient/clinician scope checks, verification, redacted observability, health/readiness routes, evaluator/API surfaces, and deployment artifacts. Current evidence is mixed local, deployed, synthetic, and owner-reviewed; do not treat all of it as one completion state.

## Current candidate override — 2026-09-20

The current candidate is `88420c1` on this branch and is deployed at
`https://dtstest.64.177.10.182.nip.io/agentforge/`. The container is healthy;
the public API collection and clean-browser readback pass. The physician-facing
surface now presents a readable visit orientation with grouped facts and
expandable provenance. Qwen remains active for synthesis and OpenRouter is active
for follow-ups. The only intentionally unfinished
submission artifact is the video; bounded Qwen tail latency and host resource
baselines remain documented limitations, not hidden claims.

## Post-rebaseline update — 2026-09-19

- The assignment source, inventory, explainer, requirements matrix, and Wayfinder map were refreshed against current code and evidence.
- Fresh local proof on 2026-09-19 is 50/50 AgentForge tests, 10/10 evals, 17/17 observability tests, and 80/80 application suites, plus 4/4 helper/PHP/provider regressions (84/84 broader checked set). The latest observability cases lock the distinction between blocked safety outcomes and operational errors, preserve bounded alert windows through the durable trace sink, enforce the documented 2% tool-failure threshold, and keep unsafe provider readback fail-closed.
- B authorization hardening is implemented in the published stack: signed context is immutable and expiry is rechecked at authorization time; live adapter defaults require the OpenEMR module issuer, session authentication, clinician role, and read scope. Current Vultr readback proves only the selected synthetic/read-only path, not production identity semantics.
- Vultr readback verifies server-only OAuth user-context retrieval and seeded synthetic records. It also records the Alibaba-compatible `qwen3.6-flash` lane activated for no-PHI synthetic evaluation; the local/default behavior remains deterministic with fallback.
- ADR-015 selects the production-grade authorization direction for future readiness: per-request synthetic user-context token or introspection semantics, with subject, active-patient, read scope, expiry/revocation, and role-denial checks. This is a simulated boundary only; no PHI, chart writes, or production authorization claim is permitted.
- The old `.scratch/overnight` queue has been summarized in `docs/agentforge/HISTORICAL_QUEUE_SUMMARY.md` and retired. It is no longer a source of record; new work must use explicitly approved GitLab issues mapped to the current requirements matrix.

## Publication update — 2026-09-19

- The clean implementation stack is rooted at `b350ced` on
  `davidslayback/agentforge-stack-03-deploy-evidence`; subsequent review
  refinements are published on the same branch.
- It is published in the private `davidslayback/agentforge-week1-staging`
  project as GitLab issues #1–#3 and stacked draft merge requests !65–!67.
- The selected Vultr runtime has fresh synthetic/read-only readback for health,
  the operational page, and the browser briefing/follow-up workflow. A
  server-only model credential rotation restored the authorized Qwen lane;
  the stack remains unmerged, and PHI, clinical write-back, and provider
  activation beyond the authorized synthetic lane remain prohibited.

The later candidate refresh supersedes the older commit identifiers in this
historical section; use the current candidate override above for release work.

## Deployment readback — 2026-09-19

- The selected runtime slice was read back at `https://dtstest.64.177.10.182.nip.io/agentforge/` on 2026-09-19 at approximately 17:46 CDT. HTTP redirects to HTTPS (308), strict HTTPS serves the app (200), `/agentforge/health` returns 200, and `/agentforge/observability` returns 200.
- A clean-browser synthetic workflow completed a briefing and the follow-up “What changed since the last visit?” with complete disposition, passed verification, and three evidence items. This verifies the externally reachable read-only demo path, not exact current-commit deployment identity.
- The earlier `/agentforge/ready` 503 was resolved by rotating the server-only model credential and increasing the model request timeout to 15 seconds; the current readback returns 200 with configuration, retrieval, model, and trace all ready. No key value is stored in the repository.
- A clean-browser synthetic briefing completed through `openai-responses` with `qwen3.6-flash`, `primary` provider status, passed verification, three evidence items, and 11,578 ms duration. The operational snapshot has zero request errors and zero pending/dropped exports. `/v1/alerts` now evaluates a five-minute window (`windowMs=300000`) and no longer fires on the retained 24,021 ms historical fallback traces; `/v1/metrics` intentionally continues to expose retained-history aggregates.
- The normal external API collection now passes end to end: health 200, readiness 200, complete and partial briefings, follow-up, blocked authorization and cross-patient cases, invalid request 400, metrics, traces, alerts, and observability all returned their expected results. The collection now fails closed on incomplete readiness dependencies and unsafe provider readback; intentional blocked/invalid cases no longer inflate `error_rate`; the live snapshot reports `errors=0` and `errorRate=0`. The signed synthetic load harness likewise fails closed unless it can acquire context and receive complete briefings. The collection's fresh Qwen and retrieval-failure traffic legitimately fires the bounded-window `p95_latency` and `tool_failure_rate` rules; the retained historical fallback traces are not part of that alert decision.
- This proves the reachable synthetic/read-only workflow can use the configured Qwen lane after server-only credential rotation. PHP 8.4 is installed locally and the launcher passes syntax validation plus executable Node/PHP parity. The current authorized candidate `6fd69eb` was rebuilt on Vultr; the deployed image is healthy, its dashboard/server source hashes match the committed tree after Windows line-ending normalization, and the public visual dashboard plus API collection were read back successfully. This still does not prove real OpenEMR identity/session semantics, PHI readiness, production authorization, clinical usefulness, provider migration, or submission readiness.

## Remaining release boundaries

- The Node and PHP authorization implementations have matching field order,
  compact JSON, base64url, HMAC-SHA-256, and five-minute expiry rules. PHP 8.4
  is installed; syntax validation and executable cross-runtime parity pass.
- The current deployed proof is synthetic, read-only, and clinician-reviewed.
  It does not prove real OpenEMR identity/session semantics, PHI readiness,
  production authorization, clinical usefulness, or compliance.
- The current candidate has fresh public dashboard and workflow readback. Load
  evidence must remain labeled as bounded synthetic observations, and CPU,
  memory, database saturation, and provider cost are not capacity claims.
- Provider activation beyond the already authorized synthetic Qwen lane, PHI,
  chart writes, publication, and final OpenRouter migration remain owner-gated.

## First phase: cleanup and rebaseline

The next agent must do this before implementing any new feature or advancing the existing queue:

1. Locate and verify the original assignment document. The repository contains `docs/agentforge/REQUIREMENTS.md`, a transcribed inventory; the source PDF is not currently stored in the repository. A prior audit worktree references `C:\Users\david\.codex\worktrees\3ef3\agentforge-week1\Week 1 - AgentForge.pdf.ob1\document.md`; verify that path and provenance rather than assuming it is current.
2. Inventory every AgentForge document, ticket, evidence file, generated artifact, branch, deployment note, and untracked media file. Classify each as current, stale, duplicate, useful historical evidence, or unknown.
3. Remove or archive outdated information rather than letting contradictory documents remain active. Preserve material evidence and user-owned artifacts until custody and reproducibility are recorded. Do not delete files merely because they are untracked.
4. Make code concise and readable where cleanup is required by the assignment path. Remove dead paths, duplicated contracts, stale fallback language, obsolete comments, and speculative abstractions. Add documentation where a future engineer or reviewer needs the behavior, boundary, or reason to use the code correctly.
5. Reconcile `ARCHITECTURE.md`, `USERS.md`, `USER.md`, `REQUIREMENTS.md`, `DECISIONS.md`, `PLANNING.md`, `FINAL_PACKAGE.md`, deployment docs, and `HISTORICAL_QUEUE_SUMMARY.md` against the verified assignment and current code. Mark claims that cannot be freshly supported.
6. Write `docs/agentforge/PROJECT_EXPLAINER.md` in plain English. It must explain the product, user, workflow, architecture, safety boundary, current implementation, evidence, known limitations, external dependencies, and remaining work. Distinguish done, partial, missing, blocked, and undecided.
7. Write or refresh `docs/agentforge/REQUIREMENTS_MATRIX.md`, mapping every assignment requirement to its source, artifact, implementation, verification, status, and remaining gap. No requirement may disappear because it was inconvenient or deferred.
8. Only after steps 1–7, rebuild the plan and GitLab issue set from the current matrix. Do not recreate the retired local queue as an alternative source of record.

Completion criterion for this phase: a reviewer can read the explainer and requirements matrix and understand what is actually done, what is not, why, and which smallest tickets close the assignment gaps.

## Assignment-grounded findings to verify

The prior audit indicates that the project became stronger as a synthetic resilience checkpoint but drifted from a strict assignment-completion plan. Reconfirm these findings rather than copying them blindly:

- Core service, fixture/evaluation paths, safety states, observability, health/readiness, API collection, and parts of deployment evidence appear substantially implemented.
- The active plan may still contain stale framing, conflicting `USER.md`/`USERS.md` treatment, and claims that reflect older checkpoints.
- Deployed 10/50-concurrency evidence, infrastructure baselines, cost projections for 100/1K/10K/100K users, final current-commit readback, interview/demo readiness, and publication decisions require explicit evidence or owner disposition.
- The local/default provider remains deterministic. Historical Vultr evidence records an explicitly authorized synthetic-only Qwen3.6 Flash evaluation lane. Provider spending, retention, data-processing, and PHI suitability remain unresolved; that deployed lane is not a production authorization.
- Synthetic OpenEMR seams are not equivalent to real OpenEMR integration, PHI readiness, BAA coverage, or production compliance.
- A JSON/browser observability surface is not the required visual dashboard. The
  visual dashboard is now an explicit implementation and readback requirement.

Treat these as audit hypotheses until refreshed against the source assignment, current branch, deployed target, and evidence files.

## Observed repository state at handoff

- Branch: `afk/AF-08-resilience-foundation`, ahead of its recorded origin by 26 commits at the time of inspection.
- Working tree: no modified tracked files were reported; multiple untracked videos, screenshots, logs, demo pages, scripts, and planning artifacts exist. Preserve and inventory them before cleanup.
- Former planning state: the retired AF-01 through AF-19 queue and evidence are summarized in `HISTORICAL_QUEUE_SUMMARY.md`; its claims are not current execution state.
- Existing project docs: `docs/agentforge/ARCHITECTURE.md`, `REQUIREMENTS.md`, `PLANNING.md`, `DECISIONS.md`, `USERS.md`, `USER.md`, final-package documents, and prior handoffs contain overlapping and time-sensitive claims.
- Existing handoff: superseded by this document.

## Known evidence snapshot

The prior audit reported these results, subject to fresh readback:

- AgentForge tests: 20/20.
- Evaluations: 10/10.
- Observability tests: 9/9.
- Public route/API/readiness/evaluator/observability checks: reported passing at prior Railway/Vultr targets.
- Signed synthetic load evidence: 100/100 at concurrency 10 and 500/500 at concurrency 50 in recorded local reports; deployed-versus-local scope must be distinguished.
- A current Vultr hostname and a Railway canonical origin are recorded in project artifacts. URLs, certificates, deployments, billing, and commit state are mutable and require fresh verification before final claims.

## Required plan after cleanup

The rebuilt plan must begin with assignment coverage, not architecture expansion:

1. Lock the verified requirements matrix and scope boundary.
2. Resolve all frontloaded human decisions: source-of-truth assignment, required artifact naming, provider/model and budget, privacy/data-retention boundary, deployment target, domain/TLS, external access, load-test authorization, interview/demo timing, and publication/no-publication. Owner direction is now synthetic-only/no-PHI, Qwen-until-final-OpenRouter-migration, and visual-dashboard-required.
3. Close documentation and claim consistency.
4. Close missing implementation and test requirements in vertical slices.
5. Run independent ticket verification from clean state.
6. Refresh deployed/runtime evidence where required.
7. Assemble the final package and plain-English explanation.
8. Stop at explicit owner gates; do not infer submission or publication authorization.

Every new ticket must map to one or more assignment requirements, declare dependencies and parallelization, name its verifier, and state the evidence required for completion. Delete or archive tickets that cannot pass that test.

## Exact next action

The cleanup/rebaseline phase is complete. The historical `.scratch/overnight` queue is retired, and the replacement GitLab program is #17 with child slices #18–#26. Use those issues with the refreshed requirements matrix and explicit evidence gates. Do not broaden the authorized Qwen3.6 synthetic lane beyond synthetic, read-only, clinician-reviewed behavior.

## Refresh commands and custody

```powershell
git status --short --branch
git log --oneline --decorate -12
git worktree list
Get-ChildItem docs/agentforge -File | Sort-Object Name
Get-ChildItem docs/agentforge -Recurse -File | Sort-Object FullName
rg -n -i "assignment|requirement|done|partial|missing|blocked|provider|cost|load|dashboard|USER\.md|USERS\.md|PHI|OpenEMR|deployment|publication" docs/agentforge
```

Refresh deployment, billing, provider, and external URL claims from the actual target before using them as completion evidence. Preserve artifact paths, branches, worktrees, and untracked media in the cleanup report.

## Approval boundaries

- Cleanup, documentation reconciliation, requirements mapping, and local planning artifacts are authorized by this handoff.
- Code cleanup is authorized only when it removes stale/duplicated/unreadable material or is required by an accepted assignment ticket; preserve behavior and record the change surface.
- Deployment changes, credential/account actions, provider spending, PHI, BAA/compliance claims, merges, publication, social posting, interview scheduling, and external messaging require explicit owner authorization.
- If a human blocker is reached, write the exact action, location, account/role, inputs, expected proof, consequence, alternatives, and resume command. “Needs credentials” is not a sufficient blocker report.

Claims about branch state, deployment state, URLs, billing, provider availability, test counts, and evidence freshness are snapshots. Refresh them before final reporting.
