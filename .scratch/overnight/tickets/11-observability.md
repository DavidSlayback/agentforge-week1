# AF-11 — Operationalize durable observability, alerts, and recovery

**GitLab:** [#12](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/12)  
**Type:** HITL  
**Blocked by:** AF-08, AF-09, AF-10 — approved data, retrieval, and provider paths  
**Wave:** 7  
**Lane:** operations / serial-required
**Critical path:** Yes — required for load, cost, release, and alert evidence.  
**Parallelization:** Serial; dashboard/alert schema must stabilize before AF-12 consumes its measurements.

## What it delivers

Durable redacted telemetry, the required live dashboard, three actionable alerts, retention/deletion controls, and verified recovery/rollback behavior.

## Acceptance criteria

- [ ] Correlation, stages, timing, retrieval/tools, retries, provider, tokens/cost, verification, display, and failures are reconstructable without raw chart text.
- [ ] Dashboard shows requests, errors, p50/p95, tools, retries, verification outcomes, and queue depth with defined semantics.
- [ ] Alerts cover p95 latency, error rate, and tool failures with thresholds, owners, runbooks, and escalation.
- [ ] Retention, deletion, access, export, redaction, and incident review are tested.
- [ ] Backup/restore, rollback, and degraded-observability behavior have current evidence.

## Verification

- Deployed dashboard/alert drill, trace reconstruction, retention check, and rollback/recovery drill.

## Independent verifier

- **Profile:** Operations verifier with read-only dashboard access and permission to trigger synthetic alert/recovery cases.
- **Commands:** `node --test observability/test/observability.test.js` and `npm --prefix evals test` — local telemetry invariants and evaluation contract pass; deployed dashboard/alert drill — p95, error-rate, tool-failure, and verification/display rules fire with the documented guidance.
- **Evidence required:** Dashboard capture or URL, alert rule/runbook inventory, triggered-alert transcript, trace reconstruction, retention/deletion result, and rollback/recovery result. The verifier must confirm queue depth is named and visible, not merely implied.
- **Verifier output:** Write `.scratch/overnight/evidence/AF-11.md` with per-criterion results, runtime/external evidence types, scope/review status, and limitations; dashboard screenshots without triggered or read-back evidence are insufficient.

## Change surface

- Telemetry backend/export, dashboard, alert rules/runbooks, recovery docs.
- Conflict risk: high; metrics semantics must remain stable for AF-12.

## Out of scope

- Unsupported SLO or scale claims before AF-12.

## Completion evidence

Dashboard URL/capture, alert drill results, trace, retention, and recovery reports.
