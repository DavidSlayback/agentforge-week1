# AF-15 — Approve final social post and external communication

**GitLab:** [#16](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/16)  
**Type:** HITL  
**Blocked by:** AF-13, AF-14 — final evidence and owner-approved narrative  
**Wave:** 11  
**Lane:** external / serial-required
**Critical path:** Yes for the full brief, but not a prerequisite for implementation.  
**Parallelization:** Serial HITL; no publication action may run in parallel with final evidence or interview approval.

## What it delivers

An owner-approved draft for the final social post and any required reviewer/external communication, with publication remaining a separate explicit decision.

## Acceptance criteria

- [ ] Draft accurately states workflow, URL, synthetic boundary, and measured evidence.
- [ ] Draft excludes PHI, credentials, unsupported compliance/production claims, invented metrics, and unverified links.
- [ ] Owner approves recipients, timing, links, and publication before anything is sent.
- [ ] If not authorized, the approved draft remains local and the stop condition is recorded.

## Verification

- Link/claim/privacy review against AF-13 and AF-14; explicit owner approval or recorded no-publish decision.

## Independent verifier

- **Profile:** External-communication/privacy reviewer with no publication authority.
- **Commands:** `rg -n "PHI|credential|BAA|HIPAA|production|synthetic|metric|URL" <draft-file>` — claims are reviewed against AF-13 evidence; no command is sufficient without explicit owner approval.
- **Evidence required:** Redacted draft, link/claim/privacy checklist, recipient/timing decision, and explicit publish or no-publish record. The verifier must confirm that the ticket cannot auto-send.
- **Verifier output:** Write `.scratch/overnight/evidence/AF-15.md` with per-criterion results, claim/privacy evidence, scope/review status, and limitations; only explicit owner approval or no-publish decision closes the ticket.

## Change surface

- Draft copy and release communication checklist only.
- Conflict risk: high external side effect; never auto-publish.

## Out of scope

- Publishing, scheduling, contacting reviewers, or sending messages without explicit approval.

## Completion evidence

Approved draft plus recorded publication/no-publication decision.
