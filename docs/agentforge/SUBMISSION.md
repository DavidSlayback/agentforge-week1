# Early checkpoint evidence

## Current status

The checkpoint branch contains a synthetic-only AgentForge service with a
fixture retrieval adapter, deterministic provider, evidence verifier, golden
evaluation runner, and redacted local traces. The service is deliberately
separate from OpenEMR so the provider and retrieval seams can be replaced
without coupling safety logic to PHP internals.

## Verified locally

- Focused tests: 10 passed.
- Golden fixtures: 7/7 passed, 0 critical failures.
- Service smoke test: `/health`, `/ready`, and a complete synthetic briefing
  request passed.
- `git diff --check` passed.

## Known checkpoint limitation

The OpenEMR-facing launcher is not yet wired into the OpenEMR patient UI. The
service root page is the current synthetic demonstration surface. The launcher,
same-origin proxy, real OpenEMR retrieval, trusted TLS, and PHI controls remain
explicit final-deadline integration work; they are not represented as complete.

## Interview talk track

- Separate service: isolates the agent boundary from the OpenEMR monolith and
  makes retrieval/provider replacement possible.
- Deterministic evaluation mode: makes safety regressions reproducible while a
  live provider remains an optional demonstration adapter.
- Verification before display: requires evidence support, patient scope, and
  read-only behavior before returning a briefing.
- Redacted local traces: preserve reconstruction value without making raw chart
  content the default observability payload.
- Launcher deferred: proxying and session binding are higher-risk deployment
  changes, so the service contract and scope checks are proven first.
