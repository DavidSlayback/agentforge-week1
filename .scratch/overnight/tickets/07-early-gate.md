# AF-07 — Pass the external early-checkpoint acceptance gate

**GitLab:** [#8](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/8)  
**Type:** HITL  
**Blocked by:** AF-02, AF-03, AF-04, AF-05, AF-06 — all checkpoint surfaces  
**Wave:** 3  
**Lane:** release-validation / serial-required
**Critical path:** Yes — checkpoint release gate and prerequisite for governed work.  
**Parallelization:** Serial; this is an external acceptance gate and cannot run concurrently with unfinished checkpoint surfaces.

## What it delivers

Current external evidence that the submitted checkpoint is reachable, conversational, safety-visible, and operationally probeable.

## Acceptance criteria

- [ ] External browser completes briefing and follow-up without certificate bypass, terminal, or manual API calls.
- [ ] Grounded, partial/qualified, and blocked/cross-patient behavior are demonstrated.
- [ ] Health, readiness, observability, and eval evidence are inspectable.
- [ ] Seven-case golden suite passes against deployment or failures block release.
- [ ] Demo/submission language is current and synthetic-only.

## Verification

- External browser rehearsal; deployed golden suite; current demo artifact review.

## Independent verifier

- **Profile:** Release verifier operating from outside the deployment host.
- **Commands:** `node evals/lib/runner.js --service "$env:AGENTFORGE_SERVICE_BASE_URL"` — seven cases, seven passes, zero critical failures; `npm --prefix evals run run:error-analysis` — six injected mutations detected; external `curl.exe` route checks and fresh-browser rehearsal — canonical path and UI pass.
- **Evidence required:** Timestamped command output, browser recording, route matrix, current demo artifact, and explicit limitation review. Any certificate bypass, manual API workaround, or missing golden case is a gate failure.
- **Verifier output:** Write `.scratch/overnight/evidence/AF-07.md` from outside the deployment host with per-criterion results, runtime/external evidence types, scope/review status, and limitations; only PASS advances AF-08.

## Change surface

- Deployment evidence, demo script/video, submission links.
- Conflict risk: high; serial release gate.

## Out of scope

- Production PHI, hosted model, or final social publication.

## Completion evidence

Timestamped route/suite results, demo capture, and owner sign-off.
