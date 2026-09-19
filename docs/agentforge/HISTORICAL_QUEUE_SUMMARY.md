# Historical AgentForge queue summary

**Retired:** 2026-09-18 (America/Chicago)
**Source:** the former `.scratch/overnight/` execution queue
**Disposition:** summarized here, then deleted at the owner's direction. This
file is historical context only and is not a ticket source of record.

## Why it was retired

The queue mixed early-checkpoint work, later synthetic OpenEMR work, owner
review gates, deployment evidence, cost/load planning, interview preparation,
and publication decisions. Its statuses were snapshots from different
candidates and were easy to mistake for current implementation truth. The
current sources of truth are the requirements matrix, project explainer,
Wayfinder map, current code, and explicitly approved GitLab issues.

## Source-of-record information retained

- The historical parent was GitLab issue #1 for AgentForge Week 1.
- AF-01 through AF-15 mapped to GitLab work items #2 through #16.
- AF-16 through AF-19 were local follow-on closure tickets for contract/claim
  reconciliation, deployed scale evidence, cost analysis, and final readback.
- The old queue's intended critical path was:
  `AF-01 → AF-03 → AF-04 → AF-07 → AF-08 → AF-09 → AF-10 → AF-11 → AF-12 → AF-13 → AF-16 → AF-17 → AF-18 → AF-19 → AF-14 → AF-15`.
- The old queue classified AF-02/03/05 as parallel checkpoint lanes and
  AF-04/06 as a serial safety/evaluator integration pair after contracts.

## Historical ticket themes

| IDs | Historical theme | Current interpretation |
| --- | --- | --- |
| AF-01 | Rebaseline the brief and evidence | Replaced by the current requirements matrix and explainer. |
| AF-02, AF-06, AF-07 | Public path, evaluator surface, early gate | Runtime claims require fresh candidate-specific verification. |
| AF-03, AF-04 | Conversation and visible safety states | Synthetic behavior exists; current requirements mapping controls future work. |
| AF-05 | Canonical contracts and API collection | `agentforge/src/contracts.js` is the executable contract authority. |
| AF-08, AF-09 | Privacy boundary and read-only OpenEMR seam | Synthetic OAuth/read-only E2E is verified; PHI and production identity remain out of scope. |
| AF-10 | Provider-ready model lane | Provider integration is deferred after `AccessDenied.Unpurchased`; no model is active. |
| AF-11 | Observability, alerts, and recovery | Synthetic operational surface exists; live dashboard semantics remain partial. |
| AF-12, AF-17, AF-18 | Load, infrastructure, and cost | Historical evidence only; do not treat it as current-candidate or billing proof. |
| AF-13, AF-14, AF-15, AF-19 | Release package, interview, external communication, final readback | Owner-gated; no publication or external communication is authorized. |

## Historical status snapshot

The deleted queue recorded AF-01 through AF-08 as `VERIFIED`, AF-09 as
`IMPLEMENTED-SYNTHETIC`, AF-10 as `IMPLEMENTED-READY`, AF-11 as
`IMPLEMENTED-SYNTHETIC`, AF-12 as `MEASURED-LOCAL`, AF-13 through AF-14 as
`READY-FOR-OWNER-REVIEW`, AF-15 as `LOCAL-DRAFT-NO-PUBLISH`, AF-16 as
`READY-DOC-CLOSURE`, AF-17 as `READY-DEPLOYED-OWNER-REVIEW`, AF-18 as
`READY-COST-OWNER-REVIEW`, and AF-19 as `READY-FOR-OWNER-REVIEW`.

These labels are deliberately not carried forward. The current matrix must
be read instead; in particular, the historical provider-ready label does not
mean a provider is currently authorized, purchased, or active.

## Evidence retained by interpretation, not raw queue files

- Local implementation baseline: 54/54 combined tests, 10/10 evals, and
  10/10 observability tests.
- Synthetic OpenEMR deployment: read-only OAuth user-context retrieval,
  seeded synthetic records, PID-to-UUID launch, and browser readback were
  verified on Vultr.
- Provider boundary: live model integration is deferred; deterministic-only
  mode is the active deployed behavior.
- Safety boundary: synthetic-only, read-only, clinician-reviewed; no PHI,
  chart write-back, publication, or production-compliance claim.

Raw queue plans, tickets, status reports, evidence JSON, and temporary trace
files were removed after this summary was written. Other repository files and
non-queue artifacts were not deleted.

## Replacement execution source

The replacement GitLab program was already present and was verified after the
old queue was retired. Do not create duplicate issues:

- [#17 — AgentForge synthetic E2E and observability implementation program](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/17)
- [#18 — AFK-1 Governance and runtime decision gate](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/18)
- [#19 — AFK-2 Contract, signed-context, and coverage hardening](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/19)
- [#20 — HITL-3 OpenEMR trust-boundary design gate](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/20)
- [#21 — AFK-4 Synthetic end-to-end OpenEMR retrieval](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/21)
- [#22 — AFK-5 Self-hosted Langfuse redacted tracing](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/22)
- [#23 — HITL-6 Provider bakeoff and governed fallback](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/23)
- [#24 — AFK-7 Dashboard, windows, queue depth, and alerts](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/24)
- [#25 — HITL-8 Integrated synthetic deployment verification](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/25)
- [#26 — HITL-9 Scale, cost, and final evidence package](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/26)
