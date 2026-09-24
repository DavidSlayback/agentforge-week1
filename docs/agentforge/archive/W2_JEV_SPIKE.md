# W2 Jev supervisor spike

Status: `accepted-with-residual` as of 2026-09-21.

This artifact records a synthetic-only paired-comparison harness for the deterministic supervisor and a Jev-backed typed judgment adapter. The application retains ownership of evidence validation, safety policy, workflow state, citations, and any future writeback; Jev only supplies a typed routing judgment. No diagnoses, orders, PHI, or live OpenEMR writes are sent to Jev.

## Current run

Deployment preparation snapshot (2026-09-22): the Vultr Compose file now passes
the Jev environment references to AgentForge and has been deployed with mode
`off`. Remote readback confirmed `AGENTFORGE_JEV_MODE=off`, no Jev key in the
container environment, a healthy service, and HTTP 200 from the public health
and landing routes. No Jev request was made. The public container still does
not invoke the Jev adapter.

The local harness ran 20 labeled cases through the deterministic supervisor:

- standard routing accuracy: `1.0`
- clarification/qualification cases: recorded
- unsafe handoffs: recorded
- traceability: present through transitions and typed handoffs
- reproducibility: present through a fixed synthetic corpus
- live Jev status: `unavailable` because `JEV_API_KEY` was not present in the process environment
- recommendation: `keep_standard`

The Jev adapter is implemented but was not activated in this run. It reads the key only from `JEV_API_KEY`, requires `AGENTFORGE_JEV_MODE=shadow`, accepts only `https://www.jevai.org/api/v1/decisions`, sends a typed route question, normalizes the response, records latency/cost, and applies a local safety guard before any Jev route can become a workflow state. The user indicated an unfunded key was supplied, but no credential value was available in this workspace process; no copy was added to the repository, this artifact, or test output. The public AgentForge service does not yet invoke the adapter.

## Recommended integration boundary

Jev is a downstream typed reviewer/router, not the scan-image VLM. The intended
sequence is:

```text
Tesseract/layout -> local VLM crop resolver -> typed extraction contract
  -> evidence retrieval/check -> optional Jev READY/QUALIFIED/CLARIFY/BLOCKED review
  -> application-owned supervisor and safety guard
```

Jev may recommend qualification, clarification, or a bounded retry when the
typed facts/citations are insufficient. It must not create facts, repair
citations, read raw PHI, generate clinical actions, or write to OpenEMR. Run it
first in shadow mode on the same synthetic corpus; the standard supervisor
remains the release baseline and Jev remains optional until the paired report
shows no safety/traceability regression and the owner accepts the measured
quality, latency, and cost trade-off.

The redacted local comparison snapshot is checked in at
`docs/agentforge/evidence/W2_JEV_COMPARISON_REPORT.json`; raw case outputs are
omitted to preserve the content-free evidence boundary.

## Promotion rule

Jev may become a candidate only when the same corpus is run through both lanes and it has no safety or traceability regression, at least baseline quality, and lower measured cost. The default deterministic comparator has no provider spend, so a lower-cost claim requires an explicitly costed standard-supervisor comparator rather than treating zero as a meaningful model price.

## Re-run with a process-only secret

After explicit owner authorization, set `JEV_API_KEY` and `AGENTFORGE_JEV_MODE=shadow` in the process environment without putting the key in a tracked file, then invoke the harness through a small local runner that imports `createJevDecisionRunner()` and `runJevSpike()`. Redact the key and raw evidence payloads from any captured output. If the provider is unavailable, retain the standard result and record `jev_unavailable` or the returned `service_failure`; do not make Jev a release dependency.

## Known residuals

- The live provider result is pending environment configuration and endpoint reachability.
- Prompt-specific error classification is not yet separately measured from the adapter boundary.
- Cost comparison is not promotion-grade until the standard supervisor has a comparable measured cost basis.
