# AF-19 — Perform final current-commit readback and release sign-off

**Type:** HITL
**Blocked by:** AF-16, AF-17, AF-18 — all final claims must be frozen first.
**Wave:** 15
**Lane:** final-release / clean-profile
**Critical path:** Yes.

## What it delivers

A final release record proving that the public URL, browser workflow, health,
readiness, operations, load, cost, evidence links, and limitations all match
the exact current candidate.

## Acceptance criteria

- [ ] Current commit/deployment identity is read back from the target host.
- [ ] Clean-browser briefing, follow-up, partial, blocked, and observability flows pass.
- [ ] Health/readiness/API collection and evaluator links resolve from the final URL.
- [ ] Submission/interview/package documents contain no stale checkpoint claims.
- [ ] Owner records release approval and a separate publish/no-publish decision.

## Verification

This is the final owner gate. A local green test suite cannot close it, and no
independent reviewer is assumed for this synthetic project.
