# AF-08 — Establish the production privacy, provenance, and compliance gate

**GitLab:** [#9](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/9)  
**Type:** HITL  
**Blocked by:** AF-01, AF-07 — full brief and stable checkpoint  
**Wave:** 4  
**Lane:** governance / serial-required
**Critical path:** Yes — governs all production-boundary tickets.  
**Parallelization:** Serial HITL decision gate; no OpenEMR/provider/telemetry expansion may proceed before approval.

## What it delivers

Approved trust-boundary decisions for source provenance/license/privacy, PHI/data flow, secrets/TLS, provider/BAA, incidents, recovery, rollback, and production claims.

## Acceptance criteria

- [ ] Baseline, attribution, license, privacy, and ownership are verified.
- [ ] PHI ingress/retention/deletion/logging policy and forbidden environments are explicit.
- [ ] Provider/data-processing/BAA and secrets lifecycle are explicit; assumed BAA is not proof.
- [ ] Incident response, rollback, backup/restore, and credential rotation have owners and evidence.
- [ ] Audit/architecture distinguish checkpoint evidence from production readiness.

## Verification

- Human review of updated audit/architecture/ADR set and recovery drill or documented accepted gap.

## Independent verifier

- **Profile:** Privacy/security/compliance reviewer independent of the implementation owner.
- **Commands:** `rg -n "PHI|BAA|retention|deletion|rollback|backup|credential|license|provenance|synthetic" docs/agentforge/*.md deploy/vultr/*` and `git diff --check` — every required boundary has a disposition; commands do not substitute for approval.
- **Evidence required:** Signed decision record, data-flow/environment matrix, secret-rotation/rollback evidence, and explicit disposition of the historical credential, trusted TLS, `/composer.json`, retention, breach, and provider gaps. Assumed compliance is an automatic failure.
- **Verifier output:** Write `.scratch/overnight/evidence/AF-08.md` with per-criterion status, decision/runtime evidence types, scope/review status, and limitations; unresolved judgment is `INCONCLUSIVE`, never PASS.

## Change surface

- Audit, architecture, decisions, deployment/security docs, release checklist.
- Conflict risk: high; governs all later trust-boundary work.

## Out of scope

- Authorizing live PHI or publication merely by closing this ticket.

## Completion evidence

Signed decision record, updated audit, and approved environment/data-flow matrix.
