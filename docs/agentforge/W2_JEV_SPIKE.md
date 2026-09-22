# W2 Jev supervisor spike

Status: `accepted-with-residual` as of 2026-09-21.

This artifact records a synthetic-only paired-comparison harness for the deterministic supervisor and a Jev-backed typed judgment adapter. The application retains ownership of evidence validation, safety policy, workflow state, citations, and any future writeback; Jev only supplies a typed routing judgment. No diagnoses, orders, PHI, or live OpenEMR writes are sent to Jev.

## Current run

The local harness ran 20 labeled cases through the deterministic supervisor:

- standard routing accuracy: `1.0`
- clarification/qualification cases: recorded
- unsafe handoffs: recorded
- traceability: present through transitions and typed handoffs
- reproducibility: present through a fixed synthetic corpus
- live Jev status: `unavailable` because `JEV_API_KEY` was not present in the process environment
- recommendation: `keep_standard`

The Jev adapter is implemented but was not activated in this run. It reads the key only from `JEV_API_KEY`, sends a typed route question to the configured REST endpoint, normalizes the response, records latency/cost, and applies a local safety guard before any Jev route can become a workflow state. The real credential supplied during the session was not stored in the repository, this artifact, or test output.

## Promotion rule

Jev may become a candidate only when the same corpus is run through both lanes and it has no safety or traceability regression, at least baseline quality, and lower measured cost. The default deterministic comparator has no provider spend, so a lower-cost claim requires an explicitly costed standard-supervisor comparator rather than treating zero as a meaningful model price.

## Re-run with a process-only secret

Set `JEV_API_KEY` in the shell or process environment without putting it in a tracked file, then invoke the harness through a small local runner that imports `createJevDecisionRunner()` and `runJevSpike()`. Redact the key and raw clinical/evidence payloads from any captured output. If the provider is unavailable, retain the standard result and record `jev_unavailable` or the returned `service_failure`; do not make Jev a release dependency.

## Known residuals

- The live provider result is pending environment configuration and endpoint reachability.
- Prompt-specific error classification is not yet separately measured from the adapter boundary.
- Cost comparison is not promotion-grade until the standard supervisor has a comparable measured cost basis.
