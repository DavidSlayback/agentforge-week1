# AgentForge project explainer

**Rebaseline date:** 2026-09-19 (America/Chicago)
**Evidence boundary:** synthetic/demo data only; read-only; clinician-reviewed.
**Source of truth:** the supplied `Week 1 - AgentForge.pdf` was verified outside
this repository. `REQUIREMENTS.md` is the repository's transcribed inventory,
not the original source.

## What the product is

AgentForge is a narrow clinical-co-pilot checkpoint for a primary-care physician preparing for a returning patient's visit. The intended moment is the short orientation window before the encounter: recall who the patient is, what changed since the comparison visit, what is documented, what is incomplete, and what requires clinician review. The interface is conversational because the physician can ask a follow-up about the same patient and retain the conversation context.

The current product is a synthetic demonstration and resilience checkpoint with a verified read-only OpenEMR integration against seeded synthetic records. The current implementation stack is published as three draft merge requests in the private staging project and has same-day synthetic Vultr readback. It is not a live clinical system, a medical decision-maker, a generic medical chatbot, a PHI-approved deployment, or a production OpenEMR integration.

## User and workflow

`USERS.md` is the detailed user/use-case document. `USER.md` is intentionally a short pointer to it because the brief names both files in different sections. The target user is a primary-care physician with a roughly 30-minute visit cadence and a 90–180-second preparation window. The core use cases are:

1. orient to the selected patient and the latest verified chart context;
2. ask what changed since the last completed encounter;
3. ask whether an existing plan was followed through;
4. surface conflicting or incomplete records; and
5. continue with a patient-scoped follow-up question.

The physician remains responsible for interpretation and action. AgentForge does not write diagnoses, medications, orders, notes, messages, or appointments.

## How it works

The service receives an already-bound clinician, active patient, read scope, and request. In live OpenEMR mode, the module resolves the authenticated session PID to the actual OpenEMR patient UUID, signs that context, and the Node adapter uses a fixed GET-only REST read map with a server-only OAuth token. Fixture-backed retrieval remains an explicit local fallback for regression tests. Results become evidence objects with source references, dates, provenance, and coverage outcomes. The verifier checks patient scope, authorization, provenance, claim support, discrepancy state, and whether required evidence is missing. Only a complete or prominently qualified result can reach the UI.

Coverage distinguishes successful data, successful empty results, failed retrieval, timeout, unauthorized access, and not-requested groups. Identity or authorization failure blocks the briefing. Partial retrieval withholds claims that depend on unavailable evidence. Chart text is treated as evidence, never as instructions.

The current code is a separate Node service under `agentforge/`. The main seams are:

- `agentforge/src/server.js`: HTTP routes, readiness, evaluator and operational surfaces;
- `agentforge/src/service.js`: briefing/follow-up orchestration, deadlines, caching, and trace lifecycle;
- `agentforge/src/openemrAdapter.js`: GET-only OpenEMR REST adapter plus explicit fixture fallback;
- `agentforge/src/fixtureAdapter.js`: deterministic fixture retrieval;
- `agentforge/src/contracts.js`: strict request/response contract validators;
- `agentforge/src/verifier.js`: evidence and generated-output verification; and
- `agentforge/src/modelProvider.js`: deterministic provider, optional OpenAI-compatible lane, retry, validation, and deterministic fallback.

`ARCHITECTURE.md` documents the OpenEMR module/adapter boundary. Current Vultr readback verifies the selected synthetic read-only runtime, launcher UUID lookup, server-only OAuth user-context token flow, seeded synthetic corpus, and deployed synthetic E2E path. No PHI is authorized, and this evidence does not establish production identity semantics, compliance, or clinical safety.

## Current evidence

Fresh local checks on this branch, verified 2026-09-19, pass:

- AgentForge service and seam tests: **50/50**;
- evaluation tests: **10/10**; and
- observability tests: **17/17** (80/80 application suites; 84/84 including helper/PHP/provider regressions), including the Langfuse exporter boundary, bounded-outage behavior, blocked-outcome error classification, durable alert-window behavior, the documented 2% tool-failure threshold, and fail-closed provider readback.

The repository also contains seven synthetic golden cases, mutation/error-analysis evidence, API-collection scripts, redacted trace persistence, alert evaluation, and recorded load reports. Those artifacts support the narrow synthetic checkpoint only. The selected Vultr runtime serves the synthetic workflow through the configured Qwen lane and `/ready` returns 200. The current candidate has 10/10 successful requests at concurrency 10 and 47/50 at concurrency 50; the latter exposes the provider tail-latency limitation. This is not production-capacity evidence.

On 2026-09-19/20, strict HTTPS and a clean browser verified the externally reachable briefing and follow-up workflow on candidate `8203ca6`. The current readback returned HTTP 200 for `/health`, `/ready`, `/observability`, `/v1/metrics`, `/v1/traces`, and `/v1/alerts`; the API collection also passed complete, partial, follow-up, blocked, invalid-request, and observability checks. The browser surface now presents grouped physician-readable facts and expandable source records. These are synthetic candidate-scoped observations, not production-capacity or clinical-usefulness claims.

## Status by area

| Area | Status | Meaning |
| --- | --- | --- |
| Original brief and requirements inventory | Done, with provenance boundary | Source PDF is verified outside the repo; the checked-in inventory is transcribed. |
| Audit, users, architecture, metrics, and safety boundary | Done for the documented checkpoint | The documents exist and are internally useful; production claims remain out of scope. |
| Conversational UI and follow-up flow | Implemented synthetic | Current candidate is deployed and browser-verified with physician-readable grouped facts, follow-up prompts, evidence expansion, reset, and blocked probe. |
| Verification, authorization, failure and partial-data behavior | Implemented synthetic | Tests cover these boundaries, including B's strict issuer/session/role defaults; live OpenEMR equivalence and current-candidate deployment proof are missing. |
| Contracts, API collection, health/readiness, traces, dashboard, alerts | Implemented synthetic | Current public API collection and visual dashboard readback pass on candidate `8203ca6`. |
| Load evidence | Partial | Current bounded Qwen smoke evidence is 10/10 at concurrency 10 and 47/50 at concurrency 50; host CPU/memory capture and larger workloads remain open. |
| Provider/model | Synthetic Qwen lane retained for now; OpenRouter is a future migration candidate | The server-only credential rotation restored primary `qwen3.6-flash` responses on Vultr; deterministic fallback remains available. No BAA, PHI approval, cost, retention, or production suitability is established. |
| OpenEMR integration | Implemented for synthetic E2E | Read-only OAuth user-context retrieval, seeded synthetic records, PID→UUID launch, and deployed synthetic readback are current candidate evidence. PHI, production identity semantics, and compliance remain out of scope. |
| PHI/HIPAA/BAA/compliance readiness | Blocked/out of scope | No PHI, clinical write-back, production compliance, or provider suitability is established. |
| Cost and scale | Partial | Cost model and 100/1K/10K/100K architecture projections exist; deployment-specific billing attribution and host resource baseline remain open. |

## Known limitations and remaining work

The smallest credible next work is requirements-led: lock this matrix, resolve owner decisions, reconcile stale claims, then make vertical changes only where a requirement and verifier are named. The future plan must explicitly close or disposition:

- production-approved OpenEMR identity, role, retention, and data-processing decisions if the scope ever expands beyond synthetic validation;
- budget, retention, and data-processing decisions for any provider scope beyond the authorized synthetic Qwen3.6 lane;
- the assignment's live dashboard and alert interpretation;
- current-candidate deployed 10/50 load and infrastructure baselines;
- cost projections at 100, 1K, 10K, and 100K users, deferred until a live conversational agent exists;
- current-commit deployment and clean-browser readback; and

None of these gaps should be closed by relabeling synthetic evidence as production proof.
