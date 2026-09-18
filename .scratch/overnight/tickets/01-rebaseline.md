# AF-01 — Re-baseline the full AgentForge brief and release evidence

**GitLab:** [#2](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/2)  
**Type:** HITL  
**Blocked by:** None  
**Wave:** 0  
**Lane:** release-planning / serial-required
**Critical path:** Yes — gates the entire queue.  
**Parallelization:** Serial; it establishes the evidence contract used by every later ticket.

## What it delivers

A current requirement-to-evidence matrix for the entire supplied AgentForge brief, including unresolved source/brief ambiguities, current deployed limitations, and explicit release gates.

## Acceptance criteria

- [ ] Every product, agent, engineering, operations, scaling, cost, and submission requirement maps to evidence or a human decision.
- [ ] Evidence strength is labeled local, repository, deployed, externally verified, or missing.
- [ ] Synthetic-only, read-only, narrow workflow, and no-compliance-claim boundaries remain explicit.
- [ ] USERS/USER, fork/privacy, interview timing, provider/BAA, and production-readiness ambiguities have stop conditions.

## Verification

- `rg -n "Requirement|Evidence|Ambigu|production|synthetic" docs/agentforge/REQUIREMENTS.md docs/agentforge/*.md` — every requirement has a traceable disposition.
- Human review of the matrix — no unsupported claim is promoted to acceptance evidence.

## Independent verifier

- **Profile:** Requirements and release-evidence reviewer, independent of the implementer.
- **Commands:** `rg -n "\|.*\|" docs/agentforge/REQUIREMENTS.md` and `git diff --check` — the supplied inventory remains complete and the migrated artifacts are clean.
- **Evidence required:** Approved requirement-to-evidence matrix with each ambiguity, evidence strength, owner, and release gate named. The verifier must reject a narrative-only claim or an assumed BAA.
- **Verifier output:** Write `.scratch/overnight/evidence/AF-01.md` with per-criterion status, source/evidence type, scope/review status, and unresolved limitations; only an explicit human-approved result advances the queue.

## Change surface

- Requirements matrix, release checklist, audit/architecture decision records.
- Conflict risk: medium; this is the source of truth for later evidence claims.

## Out of scope

- Implementing deployment, UI, OpenEMR, provider, or telemetry changes.

## Completion evidence

Approved matrix, resolved decisions, and updated GitLab #2 checklist.
