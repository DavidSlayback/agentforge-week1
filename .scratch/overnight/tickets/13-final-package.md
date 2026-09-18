# AF-13 — Verify the final production-ready release and submission package

**GitLab:** [#14](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/14)  
**Type:** HITL  
**Blocked by:** AF-09, AF-10, AF-11, AF-12 — full governed evidence set  
**Wave:** 9  
**Lane:** release / serial-required
**Critical path:** Yes — final submission gate.  
**Parallelization:** Serial; final docs and claims must be reconciled after all technical evidence is frozen.

## What it delivers

A mutually consistent, owner-approved final artifact package for the Sunday production-ready submission.

## Acceptance criteria

- [ ] URL/TLS/redirect/base path, health, readiness, and operations are rechecked immediately before release.
- [ ] Demo shows governed workflow, conversation, evidence/verification, qualified/blocked behavior, and observability.
- [ ] Setup, architecture, deployment link, decisions, API/eval instructions, and requirements traceability are reproducible.
- [ ] Provider/OpenEMR status, alerts/runbooks, load/cost, rollback, and limitations are included.
- [ ] Sign-off confirms no PHI, unsupported compliance claim, or unapproved external message.

## Verification

- Full release checklist, external browser rehearsal, evidence-link review, and human sign-off.

## Independent verifier

- **Profile:** Final release verifier using a clean browser profile and the evidence index, independent of the document author.
- **Commands:** `npm --prefix agentforge test`; `npm --prefix evals test`; `git diff --check`; external route and browser checks from AF-02/AF-07 — all pass against the release candidate and links resolve to current evidence.
- **Evidence required:** Final URL/TLS readback, demo capture, setup/architecture/deployment links, requirements matrix, provider/OpenEMR status, observability/alerts, load/cost, rollback, and limitation review. The verifier must reject stale, repository-only, or unsupported claims.
- **Verifier output:** Write `.scratch/overnight/evidence/AF-13.md` from a clean release candidate with per-criterion results, implementation/runtime/external evidence types, scope/review status, and limitations.

## Change surface

- Submission docs, demo artifacts, evidence index, release checklist.
- Conflict risk: high; final documentation owner, serial-required.

## Out of scope

- Publishing or contacting external parties.

## Completion evidence

Final URL and artifact index, current demo, checklist, and release approval.
