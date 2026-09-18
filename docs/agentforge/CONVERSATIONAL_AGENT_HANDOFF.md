# Conversational Agent — implementation handoff

**Status:** requirements-ready; implementation is not yet approved for live
clinical data.

## The honest current state

AgentForge has a running public synthetic conversational surface: it prepares a
patient-scoped briefing and accepts follow-up messages through
`POST /v1/briefings` and
`POST /v1/conversations/{correlation_id}/messages`.

That is a live service, but not yet a live clinical agent. It uses synthetic
fixtures, a simulated OpenEMR seam, and a deterministic provider by design. No
PHI, real OpenEMR retrieval, clinical write-back, or hosted model is in scope
for this implementation handoff.

## User outcome

A primary-care physician returning from one room can orient on the next
calendar-known patient, ask a short evidence-grounded follow-up, and see either
a verified answer, a qualified partial answer, or a fail-closed block. The
agent supports clinician review; it does not diagnose, recommend new care, or
write to the chart.

## Latency requirements

Measure conversational turns separately from initial briefing preparation.

| Interaction | Target | Requirement |
| --- | ---: | --- |
| Immediate UI acknowledgement | ≤250 ms p95 | Show progress without showing clinical claims. |
| Cache-backed follow-up | ≤1.5 s p95; ≤3 s p99 | Verified response only. |
| Fresh-retrieval follow-up | ≤3 s p95; hard timeout 8 s | Return a qualified result or explicit timeout state. |
| Calendar-ahead preparation | Before the encounter when possible | Must be bound to patient, clinician, schedule revision, and source revision. |

These are implementation targets, not demonstrated production SLOs. The
existing 2-second p95 alert is a provisional operational threshold and must be
reported separately from briefing latency.

## Required behavior

1. Preserve the conversation correlation ID across briefing, follow-up, tool
   calls, retries, verification, and display outcomes.
2. Bind every request to the server-verified clinician, patient, and
   `read-briefing` scope. Client identifiers are hints, never authorization.
3. Keep the conversation patient-scoped. Missing, expired, mismatched, or
   cross-patient context fails closed with no patient content.
4. Display only claims that pass source/evidence verification. Do not stream
   unverified clinical claims merely to improve perceived latency.
5. Distinguish `complete`, `partial/qualified`, `blocked`, and
   `deadline-exceeded` outcomes in both the response and trace.
6. Preserve the read-only boundary: no POST/PUT/PATCH/DELETE OpenEMR action,
   chart write-back, diagnosis, or new treatment recommendation.
7. Bound retries and record retry count, failure reason, duration, and final
   disposition without storing raw chart text in operational traces.

## Contract requirements

- Keep strict schemas as the source of truth for briefing requests,
  follow-up requests, responses, evidence, qualification, and operations.
- A follow-up must reference an existing conversation and reject a changed
  patient or clinician scope.
- Every displayed claim needs evidence references or must be withheld.
- Partial retrieval must identify failed or missing record groups and qualify
  dependent claims.
- The UI must support: prepare, follow-up, reset, partial result, denied
  authorization, cross-patient block, and malformed-request feedback.

## Observability requirements

Record, by correlation ID:

- acknowledgement, retrieval, synthesis, verification, and display durations;
- p50/p95/p99 latency by interaction type;
- retrieval attempts, retries, provider fallback, queue depth, and deadline
  outcomes;
- verification pass/fail and display disposition;
- cache hit, stale-discard, and preparation-deadline outcomes;
- redacted traces only, with retention and deletion behavior tested.

Alerts must cover conversational p95 latency, error rate, and tool-failure
rate, each with an on-call response. A dashboard may expose synthetic runtime
evidence, but it must not be presented as clinical compliance or production
capacity evidence.

## Acceptance tests

- Follow-up completes within the target for a cache-backed synthetic case.
- Fresh retrieval records its latency and returns a qualified result or the
  bounded timeout state.
- Authorization failure returns no patient data.
- Cross-patient follow-up is blocked without disclosure.
- Expired or mismatched signed context is rejected.
- Partial retrieval withholds dependent claims.
- Every response passes the strict response schema and evidence oracle.
- Correlation ID remains continuous across the full request lifecycle.
- Raw clinical text is absent from persisted traces.
- Existing AgentForge, eval, observability, and API-collection tests remain
  green.

## Implementation sequence

1. Add interaction-type latency fields and deadline outcomes to the existing
   trace contract.
2. Implement the server-owned preparation cache contract; never accept a
   client-supplied TTL, patient binding, or deadline.
3. Add the conversational latency tests above using deterministic fixtures.
4. Run deployed synthetic measurements at concurrency 10 and 50, then update
   targets only from observed evidence.
5. Keep real OpenEMR, PHI, hosted-provider, and write-back work behind separate
   owner/compliance decisions.

## Non-goals and approval boundaries

This handoff does not authorize PHI, live OpenEMR access, a hosted provider,
BAA/compliance claims, chart mutation, external publication, or a production
availability claim. Those require separate owner decisions and evidence.

## Verification commands

```text
npm --prefix agentforge test
npm --prefix evals test
node --test observability/test/*.test.js
pwsh -NoProfile -File agentforge/api/collection.ps1 -BaseUrl https://agentforge-week1-production.up.railway.app
```
