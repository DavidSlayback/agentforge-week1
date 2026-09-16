# Early checkpoint evidence

## Current status

The checkpoint branch contains a synthetic-only AgentForge service with a
fixture retrieval adapter, deterministic provider, evidence verifier, golden
evaluation runner, and redacted local traces. The service is deliberately
separate from OpenEMR so the provider and retrieval seams can be replaced
without coupling safety logic to PHP internals.

## Verified locally

- Focused tests: 11 passed.
- Golden fixtures: 7/7 passed, 0 critical failures.
- Service smoke test: `/health`, `/ready`, and a complete synthetic briefing
  request passed.
- `git diff --check` passed.

## Known checkpoint limitation

The launcher and same-origin proxy are now wired in the deployment bundle, but
the deployed OpenEMR module still requires authenticated UI activation and
manual exercise. Retrieval remains fixture-backed; trusted TLS, real OpenEMR
retrieval, and PHI controls are not represented as complete.

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
  deployment bundle. The remaining limitation is authenticated module
  activation/exercise plus the migration to trusted TLS, real OpenEMR
  retrieval, and PHI controls.
