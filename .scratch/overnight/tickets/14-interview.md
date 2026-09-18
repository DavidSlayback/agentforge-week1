# AF-14 — Prepare the evidence-bounded technical interview defense

**GitLab:** [#15](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/15)  
**Type:** HITL  
**Blocked by:** AF-13 — answers must match final artifact  
**Wave:** 10  
**Lane:** interview / serial-required
**Critical path:** Yes for the complete submission path.  
**Parallelization:** Serial after AF-13; rehearsal may not use stale checkpoint evidence.

## What it delivers

A concise, evidence-backed interview matrix and live rehearsal covering audit, architecture, verification, evals, scaling, cost, failures, and limitations.

## Acceptance criteria

- [ ] Four or more likely interview paths have answers grounded in final evidence.
- [ ] Trade-offs, failure points, mitigations, limits, costs, and unresolved risks are explicit.
- [ ] Owner can distinguish proven, inferred, and not-production-ready claims.
- [ ] No unsupported compliance, PHI, or performance claims appear.
- [ ] Human rehearsal/sign-off is complete before the interview window.

## Verification

- Timed rehearsal using final URL and evidence index; answer-to-source review.

## Independent verifier

- **Profile:** Interview rehearsal reviewer who asks unscripted questions from the submitted artifact.
- **Commands:** `rg -n "audit|architecture|verification|evaluation|scal|cost|failure|limitation" docs/agentforge/INTERVIEW_PREP.md docs/agentforge/SUBMISSION.md` — every answer topic points to current evidence; timed rehearsal is the decisive check.
- **Evidence required:** Approved question matrix, source links for each answer, rehearsal notes, and explicit correction of any overclaim. The verifier must test that the owner can distinguish implementation, runtime, and externally observable evidence.
- **Verifier output:** Write `.scratch/overnight/evidence/AF-14.md` with per-question/criterion results, source evidence type, scope/review status, and limitations; rehearsal failure is not waived by a complete document.

## Change surface

- Interview prep docs, final evidence index, demo script.
- Conflict risk: low in code; high in claim consistency, so serial after AF-13.

## Out of scope

- Scheduling or sending interview communications.

## Completion evidence

Approved question matrix and rehearsal notes.
