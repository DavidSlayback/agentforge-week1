# Synthetic incident-response drill

This runbook is for AgentForge's synthetic-only checkpoint. It is a rehearsal
of operational control flow, not a production clinical or HIPAA procedure.

## Ownership and trigger

- **Primary owner:** AgentForge service maintainer.
- **Escalation:** repository owner/service maintainer when the alert is not
  cleared by the recovery check or when a credential may have been exposed.
- **Trigger:** `/v1/alerts` reports `status: "firing"` for `error_rate`,
  `tool_failure_rate`, or `p95_latency`.
- **Evidence identifier:** preserve the redacted correlation ID and timestamp;
  never copy patient-shaped payloads into the incident record.

## Deterministic local drill

Run the bounded synthetic failure drill:

```text
node --test observability/test/incident-drill.test.js
```

The test creates a failed synthetic retrieval attempt, persists only its
redacted trace, evaluates the alert rules, and verifies that the error-rate and
tool-failure-rate alerts fire. It does not call OpenEMR, a model provider, or a
real credential.

## Response sequence

1. **Acknowledge:** record the alert IDs, UTC timestamp, redacted correlation
   ID, observed metric snapshot, and assigned owner.
2. **Contain:** stop the affected demo process or disable the failing synthetic
   upstream path. Do not add a provider or allow real data while investigating.
3. **Protect evidence:** export only the redacted trace/metrics evidence. Use
   the configured retention and explicit deletion controls; do not attach raw
   request bodies.
4. **Credential action:** if a credential could be involved, revoke/rotate it
   through the owning secret manager and record the resulting readback. The
   historical Composer credential is reported as already rotated/revoked; that
   report is not a substitute for a new secret-manager readback.
5. **Recover:** restore the last known-good synthetic trace backup when the
   trace store is implicated, then verify `/health`, `/ready`, `/v1/traces`, and
   `/v1/alerts`.
6. **Close:** document the cause, containment, recovery result, remaining
   risk, and repository-owner sign-off. Do not mark AF-08 complete from the
   local drill alone; use the reproducible local and deployed evidence bundle.

## Deployment boundary

The local drill proves alert evaluation and response evidence shape. The live
Railway drill now proves attached-volume persistence and deployment rollback
readback. Cross-region/off-host backup, external notification delivery, and
secret-manager readback remain future production-like work. Owner sign-off is
the HITL gate; no independent reviewer is assumed.
