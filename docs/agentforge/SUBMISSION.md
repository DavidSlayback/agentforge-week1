# Early checkpoint evidence

## Current status

The checkpoint branch contains a synthetic-only AgentForge service with a
fixture retrieval adapter, deterministic provider, evidence verifier, golden
evaluation runner, and redacted local traces. The service is deliberately
separate from OpenEMR so the provider and retrieval seams can be replaced
without coupling safety logic to PHP internals.

## Verified locally

- Focused tests: 20 passed.
- Golden fixtures: 7/7 passed, 0 critical failures in both reference and
  actual-service modes; deployed-service result is captured in
  `evals/deployed-service-results.json`.
- Service smoke test: `/health`, dependency-aware `/ready`, and a complete
  synthetic briefing request passed.
- Hosted smoke test: the authenticated OpenEMR chart for synthetic `Test
  Patient One` launched the active module, handed off a five-minute signed
  context, and returned a qualified briefing for `fixture-patient-002`.
- Error analysis: six injected critical defects detected, 6/6 (100%).
- `git diff --check` passed.
- `/observability` dashboard and `/v1/metrics` expose actual-run timing,
  retrieval attempts, verification/display outcomes, and redacted traces.

## Known checkpoint limitation

The deployed OpenEMR module is active and has been exercised from an
authenticated synthetic patient chart through the signed launcher to a
qualified AgentForge briefing. Retrieval remains fixture-backed; trusted TLS,
real OpenEMR retrieval, and PHI controls are not represented as complete.
The launcher-to-fixture mapping is a named demo seam, not a production
authorization implementation.

## Interview talk track

- Separate service: isolates the agent boundary from the OpenEMR monolith and
  makes retrieval/provider replacement possible.
- Deterministic evaluation mode: makes safety regressions reproducible while a
  live provider remains an optional demonstration adapter.
- Verification before display: requires evidence support, patient scope, and
  read-only behavior before returning a briefing.
- Redacted local traces: preserve reconstruction value without making raw chart
  content the default observability payload.
- Launcher status: Caddy routing and signed synthetic context are wired in the
  deployment bundle. The migration target is trusted TLS, real OpenEMR
  retrieval, and PHI controls; the checkpoint deliberately stops before those
  production commitments.
