# AF-09 — Build the authenticated read-only OpenEMR adapter

**GitLab:** [#10](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/10)  
**Type:** HITL  
**Blocked by:** AF-08, AF-07 — approved boundary and synthetic parity baseline  
**Wave:** 5  
**Lane:** data-integration / serial-required
**Critical path:** Yes — required by provider, observability, load, and final evidence.  
**Parallelization:** Serial with provider integration; no concurrent edits to the retrieval contract or authorization binding.

## What it delivers

A governed, authenticated, read-only OpenEMR retrieval seam with server-side patient binding, normalized evidence/coverage, and fixture parity.

## Acceptance criteria

- [ ] Browser identifiers/authorization claims are not trusted without server verification.
- [ ] Auth, scope, empty, partial, timeout, and upstream-failure semantics are tested.
- [ ] Fixture/OpenEMR parity holds for equivalent cases.
- [ ] Multi-user and cross-patient isolation prevents response/log/trace leakage.
- [ ] Governed environment and rollback path are documented; current synthetic deployment stays synthetic until approved.

## Verification

- Authenticated integration suite and parity report in a non-production governed environment.

## Independent verifier

- **Profile:** OpenEMR/authentication verifier with separate test identities and patient fixtures.
- **Commands:** `npm --prefix agentforge test` plus the ticket's authenticated adapter test command `node --test agentforge/test/openemr-adapter.test.js` — parity, auth, empty, partial, timeout, failure, and isolation cases pass; missing test file is a failure.
- **Evidence required:** Governed-environment run, identity/permission matrix, fixture/OpenEMR parity report, redacted trace review, and rollback result. The verifier must confirm the browser cannot choose authorization or patient scope by itself.
- **Verifier output:** Write `.scratch/overnight/evidence/AF-09.md` from the exact candidate stack with per-criterion results, runtime/external evidence types, scope/review status, and limitations; missing environment evidence is `INCONCLUSIVE`.

## Change surface

- Retrieval adapter, authorization/context binding, evidence normalization, integration tests.
- Conflict risk: high; serial with provider and observability work.

## Out of scope

- Write-back, clinical recommendations, or unapproved production PHI.

## Completion evidence

Environment run, isolation results, parity report, and rollback evidence.
