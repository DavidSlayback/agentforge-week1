# AgentForge resilience boundary

This document defines the production-like controls for the synthetic AgentForge
platform. It does not authorize real PHI, live clinical retrieval, clinical
write-back, or a hosted provider.

## Environment and data flow

| Environment | Data | Allowed processing | Forbidden processing | Evidence |
| --- | --- | --- | --- | --- |
| Local tests | Synthetic fixtures | Retrieval, verification, deterministic synthesis, redacted traces | PHI, real credentials, external provider calls | Repository test suites |
| Railway checkpoint | Synthetic fixtures and safe request metadata | Public demo flow, redacted metrics/traces, evaluator evidence | PHI, live OpenEMR, production claims | AF-02/AF-06/AF-07 evidence |
| Future governed simulation | Synthetic fixtures with simulated auth/upstream failures | Recovery, retention, backup, rollback, alert, and load drills | PHI, real clinical writes, unapproved provider | AF-08 onward evidence |

## Implemented local controls

- Trace payloads redact patient, chart, prompt, response, note, contact, and
  author fields before storage.
- `FileTraceSink` bounds records, applies configurable expiry, persists through
  a temporary file and rename, reloads after restart, and supports explicit
  `deleteAll()` cleanup.
- `FileTraceSink.backup(path)` and `.restore(path)` provide a validated local
  recovery seam. Backup files are written with owner-only permissions.
- `AGENTFORGE_TRACE_PATH` and `AGENTFORGE_TRACE_RETENTION_MS` make the storage
  and retention policy explicit rather than hidden in code.
- `/v1/alerts` evaluates deterministic p95-latency, error-rate, and tool-failure
  rules with explicit thresholds from environment configuration.
- `INCIDENT_RESPONSE.md` defines the owner, escalation, evidence, containment,
  credential-action, recovery, and closure sequence; the local drill verifies
  a synthetic retrieval failure fires the expected redacted alerts.
- The service-backed golden test uses an isolated trace store so old test data
  cannot contaminate current evidence.

## Required drills before AF-08 can pass

1. Run a retention/deletion drill and read back that expired and explicitly
   deleted traces are absent.
2. Create a backup, destroy the active trace store, restore it, and compare
   redacted counts and correlation continuity.
3. Exercise a failed deployment and document the rollback target, owner, and
   readback result. A local code test is not deployment rollback evidence.
4. Trigger synthetic retrieval/tool failures and verify the alert rule, owner,
   runbook, escalation, and recovery action. The bounded local drill is
   implemented; deployment alert delivery and external incident ownership are
   still open.
5. Rehearse incident handling using synthetic data only, including credential
   revocation/rotation and an audit record of the response.

## Non-claims

These controls demonstrate implementation behavior and synthetic recovery
semantics. They do not establish HIPAA compliance, a BAA, live OpenEMR parity,
provider suitability, or production availability. AF-08 remains open until an
independent reviewer verifies the required drills.
