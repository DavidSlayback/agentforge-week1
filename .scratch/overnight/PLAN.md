# AgentForge full-brief execution plan

## Scope

This queue covers the complete AgentForge brief in `docs/agentforge/REQUIREMENTS.md`, the current architecture/audit/decision records, the deployed checkpoint, and the early evaluator feedback. It is intentionally larger than the immediate MVP recovery: the path continues through a production-like synthetic OpenEMR seam, deferred provider review, operational maturity, deployed scale/cost evidence, final submission, interview defense, and explicitly approved external communication.

The GitLab parent is [#1](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/1). Child issues are #2–#16. This queue mirrors those issue boundaries.

## Evidence boundary

- Current proof is synthetic/demo-only and fixture-backed.
- The downloaded file named `Week 1 System Design Assignment.pdf` is an unrelated affiliate-link assignment. The original AgentForge PDF is not stored in this repository; `docs/agentforge/REQUIREMENTS.md` is the transcribed requirements inventory supplied from that brief and is treated as the governing checklist.
- No ticket authorizes PHI, clinical write-back, a HIPAA/compliance claim, or external publication. A hosted model remains deferred and requires the explicit provider HITL gate; all test data stays synthetic.

## Current state

Already strong: audit, architecture, ADRs, narrow workflow, deterministic provider, fixture contracts, verification/evals, redacted observability paths, and repository documentation.

Checkpoint gaps: trusted public URL/TLS, browser-visible multi-turn interaction, visible qualification/authorization states, evaluator discoverability, and externally exercised health/readiness/observability/eval gates.

Future brief gaps: production-like simulated OpenEMR identity/retrieval seam, deferred provider/data-processing decision, durable observability/alerts/recovery, deployed load and cost evidence, production-ready synthetic release package, interview defense, and owner-approved social/external communication.

## Execution strategy

1. Resolve the full requirements/evidence baseline.
2. Recover the public, conversational, safety-visible checkpoint in parallel lanes where the graph allows.
3. Run the external early gate.
4. Only then widen the simulated trust boundary under explicit provenance/provider/operations decisions; do not introduce PHI.
5. Measure the governed system, assemble final evidence, rehearse the interview, and stop before external publication unless separately approved.

## Human boundaries

HITL tickets are not AFK-safe because they require DNS/certificates, external environments, privacy/compliance/provider decisions, budget or production evidence, human release sign-off, rehearsal, or publication approval. AFK tickets are limited to repository-owned deterministic UI/contracts/evaluator-surface work.

## Migration audit

Migration mode preserved all 15 stable IDs, GitLab references, acceptance criteria, domain language, and existing dependency intent. No ticket was split: AF-01 and AF-08 are decision gates, AF-11 is a coupled operational gate, and AF-13 is a serial release gate; splitting any of these would hide rather than remove the human boundary. Every ticket now names critical-path position, parallelization/integration order, an independent verifier profile, deterministic commands where available, and evidence that the verifier must inspect independently.

- **Unchanged tickets:** AF-01 through AF-15 as scopes and acceptance contracts; no renumbering or replacement.
- **Modified tickets:** all AF-01–AF-15 ticket files, limited to migration metadata, verifier profiles, command/evidence requirements, and conflict/integration notes.
- **Newly split tickets:** none.
- **New HITL decisions:** source-of-truth confirmation for the repository-stored requirements inventory versus the original brief; canonical hostname/trusted TLS; synthetic-only production boundary; deferred provider/BAA decision; simulated authenticated OpenEMR seam; durable operations and scale-budget evidence; final release/interview/publication approval. Existing production tickets already carried most of these boundaries; migration makes them explicit.
- **AFK classification audit:** AF-03, AF-04, AF-05, and AF-06 remain AFK because each has a repository-owned deterministic test path and the external browser gate remains separately HITL. If implementation cannot supply the named black-box tests, downgrade that ticket to HITL before dispatch.
- **Parallel lanes:** Wave 1 deployment, product UI, and contracts; Wave 2 safety UI and evaluator work may be developed separately but integrate serially because of shared UI surfaces. Later waves are intentionally serial HITL gates.
- **Critical path:** AF-01 → AF-03 → AF-04 → AF-07 → AF-08 → AF-09 → AF-10 → AF-11 → AF-12 → AF-13 → AF-16 → AF-17 → AF-18 → AF-19 → AF-14 → AF-15, with AF-02 → AF-06 → AF-07 and AF-05 → AF-06 as parallel checkpoint branches.
- **First executable frontier:** AF-01 / GitLab #2 only, and it is HITL. No AFK ticket is executable until AF-01 is approved and complete.

## Quality-gate result

The original migrated queue passed structural planning gates and was approved for local execution. The follow-on queue adds four explicit HITL closure gates; do not infer them from the earlier checkpoint evidence.

### Gate audit

- [x] Acceptance criteria and verification signal for every ticket
- [x] Independent verifier profile and evidence file for every ticket
- [x] Blocker reason for every dependency edge
- [x] Acyclic graph and exactly one wave/lane per ticket
- [x] Shared-file/schema/config conflict risks and integration order
- [x] Critical path and non-critical parallel branches identified
- [x] HITL decisions explicit; no external or safety decision disguised as AFK
- [x] AFK tickets have deterministic repository commands; downgrade rule recorded
- [x] First frontier identified as AF-01 / `NEEDS_HUMAN`

## Local execution reconciliation

David approved the migrated queue for local-only execution. AF-01 through AF-08 are recorded as verified for the checkpoint. AF-09 through AF-12 now have synthetic local implementation/evidence. AF-16 is the next local documentation gate; AF-17, AF-18, and AF-19 remain external/owner gates. No remote mutation is authorized.

## Full-build execution update — 2026-09-18

- AF-09: added server-verified signed synthetic context, strict patient/
  clinician/scope binding, expiry/mismatch tests, and fixture parity evidence.
- AF-10: added two retries plus deterministic fallback around the optional
  provider interface; no live vendor was selected.
- AF-11: extended the dashboard and metrics with retries, fallbacks, queue
  depth, verification/display outcomes, and alert state; fixed concurrent
  Windows trace persistence.
- AF-12: added the reproducible load harness and measured signed synthetic
  runs at concurrency 10 and 50 with zero errors.
- AF-13–AF-15: created the final package, interview defense, and local-only
  external draft; deployment readback and timed rehearsal remain HITL.
- AF-16–AF-19: added the remaining assignment-closure gates for the required
  `USER.md` pointer and 90–180-second workflow framing, deployed load and
  infrastructure evidence, actual cost/projections, and final current-commit
  clean-profile readback/sign-off.

## Coverage map

| Brief area | Ticket(s) |
| --- | --- |
| Baseline, provenance, audit, users, metrics, synthetic boundary | AF-01, AF-07 |
| Public deployment and canonical URL | AF-02, AF-06 |
| Multi-turn agent and justified use cases | AF-03, AF-04 |
| Verification, authorization, partial/failure behavior, isolation | AF-04, AF-06, AF-07 |
| Strict contracts and runnable API collection | AF-05 |
| Correlation IDs, observability, dashboard, queue depth, alerts | AF-06, AF-10, AF-11 |
| Health/readiness separation | AF-02, AF-06 |
| Deployed load, infrastructure baselines, cost projections | AF-12, AF-17, AF-18 |
| Simulated authenticated OpenEMR and production-like trust boundary | AF-08, AF-09 |
| Provider/data-processing/model failure policy | AF-08, AF-10 |
| Early, final, interview, and social submission path | AF-07, AF-13, AF-14, AF-15, AF-16, AF-19 |
