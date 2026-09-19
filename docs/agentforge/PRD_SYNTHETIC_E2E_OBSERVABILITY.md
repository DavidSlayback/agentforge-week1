# AgentForge synthetic end-to-end integration and observability PRD

**Status:** Draft for owner review; not published and not an implementation authorization.
**Boundary:** synthetic data only, read-only, clinician-reviewed.
**Primary goal:** turn the current fixture-backed checkpoint into a verifiable synthetic end-to-end OpenEMR workflow with self-hosted observability and one governed OpenAI-compatible model lane, without introducing PHI or chart write-back.

## Problem Statement

AgentForge currently proves important safety behavior locally: strict response contracts, patient/clinician scope checks, evidence verification, partial-data qualification, retries, deterministic fallback, redacted traces, and synthetic evaluation cases. The OpenEMR module launcher is not yet a true end-to-end retrieval path: it maps an OpenEMR session PID to a fixture patient and sends a signed synthetic token to the Node service.

The current operational page is also a custom JSON-backed view rather than an independently verified external observability dashboard. The service has a local redacted trace sink, but queue depth is not wired to runtime work and documented alert windows do not match the aggregate implementation. Finally, the optional OpenAI-compatible provider seam is not yet an approved or verified OpenRouter lane.

The assignment needs a narrow, defensible path that can be demonstrated from OpenEMR context through read-only retrieval, verification, model/fallback behavior, clinician-facing output, and observable runtime evidence.

## Solution

Build one governed synthetic vertical path:

`OpenEMR authenticated patient context → signed server context → allowlisted OpenEMR reads → canonical AgentForge contract → coverage-scoped evidence → verification → deterministic or OpenRouter-compatible synthesis → verified read-only UI → redacted Langfuse trace/dashboard`

Use `agentforge/src/contracts.js` as the executable contract authority. Keep OpenEMR, retrieval, provider, verifier, and observability behind replaceable interfaces. Adopt self-hosted Langfuse as the observability UI and trace backend, exporting only redacted synthetic metadata. Keep the local trace sink as a fail-safe and test oracle until external ingestion and dashboard readback are proven.

OpenRouter remains a future comparison candidate. The current authorized Alibaba Cloud Model Studio lane uses Qwen3.6 Flash through the compatible Responses interface; the deterministic provider remains the safe baseline and fallback. This does not authorize PHI.

## User Stories

1. As a primary-care physician, I want a reliable, accurate, on-time summary before the visit, so that I can orient quickly without rebuilding the chart manually.
2. As a physician, I want the summary to explain what changed since the last completed encounter, so that the visit starts from the current clinical context.
3. As a physician, I want the summary to distinguish documented facts from missing, conflicting, stale, or failed-to-retrieve information, so that I do not have to second-guess whether an apparent change is trustworthy.
4. As a physician, I want to ask follow-up questions about the summary and receive answers grounded in the same evidence, so that I can explore the patient context conversationally without restarting the review.
5. As a physician, I want to follow an evidence link back to the relevant OpenEMR record when needed, so that I can inspect the source rather than trusting an opaque synthesis.
6. As a physician, I want the assistant to stay scoped to the patient I opened and the clinician context that authorized the review, so that conversational convenience never becomes cross-patient leakage.
7. As a physician, I want the assistant to remain read-only and avoid diagnoses, recommendations, prescriptions, orders, notes, messages, or appointments, so that interpretation and action remain mine.
8. As an operator, I want provider calls retried within a bounded budget and then safely replaced by deterministic synthetic output, so that temporary model failures do not silently become unsafe output.
9. As an operator, I want readiness to report configured dependency health separately from fallback availability, so that a fallback does not conceal an unavailable model dependency.
10. As an operator, I want redacted request traces with correlation IDs, stage timing, retrieval outcomes, retries, provider fallback, verification, and display status, so that a request can be reconstructed without storing chart content.
11. As an operator, I want those traces visible in a self-hosted Langfuse dashboard on the existing VM, so that the assignment’s observability requirement is demonstrated without adding another hosted machine.
12. As an operator, I want dashboard metric windows and queue depth to reflect actual runtime behavior, so that latency and failure alerts are interpretable.
13. As an evaluator, I want runnable API probes and golden/mutation cases to exercise the same synthetic end-to-end path, so that evidence is repeatable and not just a browser demo.
14. As an owner, I want deployment, provider, retention, cost, and publication decisions separated from implementation evidence, so that no synthetic checkpoint is mislabeled as production readiness.

## Implementation Decisions

- `contracts.js` is the executable source of truth for request and response fields. Architecture prose and API examples must conform to it.
- Briefing and follow-up paths require server-verified signed context. Body authorization is rejected by the canonical contract and runtime; redacted operational endpoints are a separate metadata surface.
- The OpenEMR boundary is a server-side read adapter with an explicit operation allowlist. No model-controlled URLs, SQL, HTTP methods, identifiers, or write operations are allowed.
- Adapter results are coverage-scoped. Failed, timed-out, and unauthorized groups contribute no usable records; empty groups contribute no records; dependent claims are withheld.
- Deterministic provider output remains the default synthetic baseline. OpenRouter is accessed only through the existing OpenAI-compatible provider interface.
- Provider resilience is two retries, output validation, then visible deterministic fallback. Configured-provider outage makes `/ready` not ready even when fallback can serve synthetic output.
- Langfuse is the selected self-hosted observability platform. AgentForge’s redaction and trace contract run before export and remain authoritative for safety tests.
- Langfuse ingestion must be fail-safe: observability outage must not expose raw content or make the clinical-facing synthetic response unsafe. The local sink remains available for tests and bounded recovery.
- The dashboard must expose requests, errors, p50/p95/p99 latency, retrieval/tool attempts, retries, queue depth, verification outcomes, display outcomes, provider fallback, and alert state with explicit time-window semantics.
- The first live-provider bakeoff compares the deterministic baseline against one configured OpenAI-compatible provider at a time. Candidate endpoints may be OpenRouter or Alibaba Model Studio; exact model IDs, region/base URL, budget, and retention are recorded from the provider account rather than guessed from a draft name.
- Provider activation is permitted for synthetic data once the owner supplies the key through the approved secret path. No key is committed, pasted into source, or used with PHI.

## Testing Decisions

- Test external behavior at the highest available seam: OpenEMR launcher/context, HTTP service, provider boundary, Langfuse ingestion/dashboard readback, and deployed browser/API client.
- Preserve the existing local suites as regression gates: AgentForge service/auth/contract/provider/UI tests, seven golden fixtures, six mutation defects, and observability persistence/redaction tests.
- Add black-box tests for deployed signed-context enforcement and prove legacy mode cannot be used as deployment evidence.
- Add coverage mutation tests where fixture records exist but their retrieval group is failed or timed out; the response must not expose those records.
- Add provider decision-table tests for deterministic-only, configured-and-ready, missing key, timeout, retry exhaustion, invalid output, and fallback.
- Add Langfuse integration tests using a local self-hosted instance or isolated test endpoint. Assert correlation continuity, redaction, trace completeness, and behavior when Langfuse is unavailable.
- Add dashboard readback tests that generate known synthetic traffic and verify metric deltas, time-window semantics, queue depth, retries, verification outcomes, and alert firing.
- Treat deployment, TLS, exact image/commit, resource baselines, load reports, cost, and owner approval as external evidence gates; local tests cannot close them.

## Out of Scope

- PHI, real clinical use, production compliance, BAA approval, clinical write-back, recommendations, diagnoses, orders, prescriptions, notes, messages, and appointments.
- Replacing the clinician’s judgment or presenting the system as a medical decision-maker.
- General-purpose OpenEMR tools or model-selected data access.
- Langfuse Cloud, LangSmith migration, multi-region durability, enterprise SSO, or production HA unless separately approved.
- Provider activation without an explicit model, budget, synthetic-only data boundary, and secret-handling decision.
- Deployment changes, external communication, publication, merge, push, or PR creation under this planning session.

## Further Notes

This PRD deliberately separates four proof levels: local code behavior, synthetic end-to-end behavior, external deployed observability/runtime behavior, and production/PHI readiness. Passing one level must not be used to claim the next.
