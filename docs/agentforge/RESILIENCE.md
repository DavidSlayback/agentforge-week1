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

## Live Railway evidence (2026-09-18)

- Railway rollback of a prior deployment reported success. The service briefly
  showed no active deployment, then recovered to the alert-enabled deployment;
  the public collection passed after recovery.
- A synthetic partial-retrieval sequence caused `/v1/alerts` to return
  `status: "firing"` with `tool_failure_rate` observed at
  `0.17142857142857143`.
- The simulated OpenEMR seam rejects missing, expired, mismatched, or
  non-`read-briefing` signed contexts before retrieval; matching contexts keep
  clinician and patient scope server-side.
- A failing provider is retried twice and then falls back to the deterministic
  provider, with retry and fallback status retained in the redacted trace.
- Railway now shows one replica, the attached `agentforge-week1-volume` (volume
  id `2cd958f4-fe4c-48fc-8a45-042f267e076c`), and the service is configured with
  `AGENTFORGE_TRACE_PATH=/data/traces.json` on mount `/data`.
- A sentinel redacted trace with correlation ID
  `af-1789742039771-a2a58e89b05cb8` survived the confirmed Railway redeploy;
  the active deployment reported success and the service returned Online.

## Future production-like drills beyond this checkpoint

1. Retain the passing retention/deletion and redaction drills as regression
   evidence.
2. Add scheduled/off-host backup and restore, with redacted counts and
   correlation continuity, if the scope moves beyond this checkpoint.
3. Add external alert delivery and a production incident owner/escalation
   integration; the bounded local and live endpoint drills are implemented.
4. Rehearse secret-manager credential revocation/rotation with an audit
   readback before introducing any real provider or governed environment.

## Non-claims

These controls demonstrate implementation behavior and synthetic recovery
semantics. They do not establish HIPAA compliance, a BAA, live OpenEMR parity,
provider suitability, cross-region durability, or production availability.
AF-08 is ready for owner sign-off on the reproducible evidence; no independent
review is claimed or required for this synthetic checkpoint.
