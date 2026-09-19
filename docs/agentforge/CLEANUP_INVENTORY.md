# AgentForge cleanup inventory and report

**Audit date:** 2026-09-19 (America/Chicago)
**Controlling handoff:** `docs/agentforge/HANDOFF.md`
**Change boundary:** cleanup/rebaseline inventory plus the current review stack; no
PHI, clinical write-back, or provider activation.

## Source and repository state

| Item | Readback | Classification / custody |
| --- | --- | --- |
| Original assignment PDF | `C:\Users\david\.codex\worktrees\3ef3\agentforge-week1\Week 1 - AgentForge.pdf`, 249,370 bytes; extracted `document.md`, 24,813 bytes | Verified source outside repo; preserve path/provenance, do not copy into the repository without an explicit artifact decision. |
| Repository requirements inventory | `docs/agentforge/REQUIREMENTS.md` | Current transcription; not completion evidence by itself. |
| Active branch | `davidslayback/agentforge-stack-03-deploy-evidence` (implementation base `b350ced`; review refinements published on the same branch) | Current local source state; published to the private staging project as a draft stacked review. |
| Working tree | Clean after the current stack | Generated/support artifacts remain in the recoverable local archive; no user-owned changes were discarded. |
| Worktrees | Main checkout; detached `3ef3` at `297c10a`; diagrams worktree at `32c8f9d` | Useful historical/parallel state; no mutation or cleanup performed. |
| Remotes | Group `gitlab` project is protected/Developer-blocked; private staging project `davidslayback/agentforge-week1-staging` holds the current issues and draft MRs; `origin` is the David fork; `upstream` is the Gauntlet OpenEMR base | Current provenance map; remote state not treated as release proof. |

## Documentation inventory

| Area | Files | Classification | Finding |
| --- | --- | --- | --- |
| Assignment/audit | `REQUIREMENTS.md`, `AUDIT.md` | Current | Grounded in the verified brief and audit scope; source-PDF provenance is now explicit. |
| Product model | `USERS.md`, `USER.md` | Current | `USERS.md` is canonical; `USER.md` is a pointer to resolve the brief's naming conflict. |
| Architecture/decisions | `ARCHITECTURE.md`, `DECISIONS.md`, `RESILIENCE.md`, `OBSERVABILITY.md`, `INCIDENT_RESPONSE.md` | Current but claim-sensitive | Useful design and safety records; runtime/deployment statements must be read as dated evidence. |
| Operational measurements | `KEY_METRICS.md`, `LOAD_TEST.md`, `COST_MODEL.md` | Deferred/current drafts | Preserve the artifacts; defer load/cost interpretation until a live conversational agent exists. |
| Planning | `PLANNING.md`, archived `NEXT_STEPS_PRD.md` | Historical/current mixed | Useful planning context; not the rebaselined plan. The untracked draft is archived outside the repository; do not advance it in this phase. |
| Submission/interview artifacts | `FINAL_PACKAGE.md`, `SUBMISSION.md`, `FINAL_INTERVIEW_PREP.md`, `INTERVIEW_PREP.md`, `INTERVIEW_PREP_VISUAL.html`, `FINAL_SOCIAL_DRAFT.md` | Historical/supporting | Preserve as existing artifacts; they are not part of the active implementation map. |
| Demo/evidence pages | Archived `DEMO_SCRIPT.html`, `EVAL_EVIDENCE.html` | Untracked generated/useful | Moved outside the repository on 2026-09-19; preserve in the local archive until final demo custody is decided. |
| Handoffs | `HANDOFF.md`, `CONVERSATIONAL_AGENT_HANDOFF.md` | `HANDOFF.md` current; conversational handoff historical/current mixed | The rebaseline handoff controls this phase. The conversational handoff is supporting context only. |
| New rebaseline outputs | `PROJECT_EXPLAINER.md`, `REQUIREMENTS_MATRIX.md`, this report | Current | Created in this phase; intended reviewer entry points. |
| Wayfinder map | `WAYFINDER_MAP.md`, `wayfinder/tickets/` | Current/open | Claim-status index plus decision tickets; the historical overnight queue is now summarized and retired. |

## Code and generated artifact inventory

| Item | Classification | Evidence / disposition |
| --- | --- | --- |
| `agentforge/src/*` service, contracts, adapters, provider, verifier, UI | Current implementation | Preserved; behavior covered by fresh 50/50 AgentForge tests. Qwen3.6 activation remains limited to the authorized synthetic Vultr evaluation lane; no PHI or clinical write-back is allowed. |
| `agentforge/test/*` | Current verification | Fresh AgentForge service/seam run: 50/50; application-suite run: 77/77. The separate load-harness and provider-verifier regressions are 1/1 each, making the broader checked set 79/79. |
| `evals/*` and `docs/agentforge/fixtures/*` | Current synthetic evidence | Fresh `npm --prefix evals test`: 10/10; fixtures remain synthetic and must not be loaded as PHI. |
| `observability/*` | Current synthetic operational evidence | Fresh `node --test observability/test/*.test.js`: 17/17, including Langfuse redaction, continuity, bounded export-pressure, blocked-outcome classification, durable alert-window, and tool-failure-threshold tests. |
| `scripts/agentforge-load.mjs`, API collection, deployment compose/config | Current tooling | Preserved; use only with explicit candidate/environment identity. |
| Former `.scratch/overnight/` plans, queue, DAG, waves, stack, checkpoint, report, and decisions | Retired historical execution state | Summarized in `HISTORICAL_QUEUE_SUMMARY.md`, then deleted at the owner's direction so it is no longer treated as active planning. |
| Former `.scratch/overnight/tickets/01–19` and evidence files | Retired historical queue/ticket evidence | Relevant themes, dependencies, statuses, and evidence interpretation were extracted into `HISTORICAL_QUEUE_SUMMARY.md`; raw queue files were deleted. |

## Untracked media and local artifacts

The following were present and deliberately moved, not deleted. Their content, duration, provenance, and final custody were not independently reviewed; preserve them as unclassified evidence in `C:\Users\david\repos\agentforge-week1-local-archive-20260919T104458`:

| Files | Classification |
| --- | --- |
| `agentforge-checkpoint-demo.mp4`, `agentforge-checkpoint-demo-3min.mp4`, `agentforge-checkpoint-demo-final.mp4`, `agentforge-checkpoint-demo-final2.mp4` | Candidate demo media; duplicate/variant status unknown; archived outside repo. |
| `agentforge-checkpoint-demo-preview.png`, `agentforge-final-contact.png`, `demo-5.png`, `demo-35.png`, `demo-75.png`, `demo-115.png`, `demo-contact.png` | Screenshots/contact sheets; useful historical evidence, final custody unknown; archived outside repo. |
| `agentforge-recorder-2.log`, `agentforge-window-test.log`, `demo-stretch.log` | Recording/debug logs; archived outside repo until media provenance is settled. |
| `docs/agentforge/DEMO_SCRIPT.html`, `docs/agentforge/EVAL_EVIDENCE.html`, `docs/agentforge/FOLLOW_UP_AGENT.md`, `docs/agentforge/INTERVIEW_PREP.md`, `docs/agentforge/INTERVIEW_PREP_BRIEF.html`, `docs/agentforge/INTERVIEW_PREP_BRIEF.md`, `docs/agentforge/INTERVIEW_PREP_VISUAL.html`, `docs/agentforge/NEXT_STEPS_PRD.md`, `scripts/demo-guide-server.mjs`, rendered interview PDFs, and PDF build scripts | Untracked generated/support artifacts; moved outside the repository because they are not part of the active implementation stack. |

## Contradictions and claim repairs

1. **Source provenance:** older queue text treated the repository transcription as the only assignment source. The source PDF and extraction are now verified outside the repo; the matrix distinguishes both.
2. **User filename:** the brief requires `USERS.md` in the stage gate and names `USER.md` in submission requirements. The pointer arrangement is retained and documented.
3. **Deployment identity:** Railway is earlier checkpoint evidence. The current selected Vultr runtime was read back against the current synthetic stack; deployment evidence remains candidate-scoped and does not establish PHI or production readiness.
4. **Provider:** Qwen3.6 Flash is an authorized synthetic Vultr evaluation lane. It does not establish funding, retention, contractual coverage, or approval for PHI.
5. **OpenEMR:** the deployed read-only OAuth path and seeded synthetic corpus now have E2E evidence; that evidence is still not PHI readiness, production role/session equivalence, or compliance evidence.
6. **Dashboard:** the JSON/browser observability page demonstrates an operational surface. The assignment's live dashboard requirement remains mapped as partial until the exact external evidence is verified.
7. **Queue advancement:** the former queue mixed historical checkpoint and owner-review state. It is retired; `HISTORICAL_QUEUE_SUMMARY.md` is the only retained summary, and new work must use current requirements plus approved GitLab issues.

## Actions completed and intentionally not completed

Completed: verified the assignment source; refreshed Git/worktree/file/deployment endpoint state; inventoried docs, code, evidence, branches, deployments, and untracked media; created and refreshed the plain-English explainer and requirements matrix; ran the three local test suites; created the claim-consistency Wayfinder map and decision tickets; verified seeded synthetic OpenEMR E2E behavior without PHI; extracted and retired the historical overnight queue; moved 29 generated/support artifacts to the recoverable local archive outside the repository; published the current implementation stack as GitLab issues and stacked draft merge requests.

Not done by design: delete user artifacts, edit the historical queue, merge the draft stack, activate a provider beyond the authorized synthetic lane, or load PHI. PHP 8.4 is now installed and the launcher syntax-checks; executable Node/PHP authorization parity still needs a focused run. The visual dashboard remains an open required deliverable; broader release, production identity, compliance, and clinical-safety claims remain open.

## Durable checkpoint

The reviewer entry points are:

1. `docs/agentforge/PROJECT_EXPLAINER.md`
2. `docs/agentforge/REQUIREMENTS_MATRIX.md`
3. this inventory/report
4. `docs/agentforge/HANDOFF.md`

The next authorized phase is plan reconstruction only after independent documentation and code reviews. Do not infer queue advancement from the historical `AF-16`–`AF-19` statuses.
