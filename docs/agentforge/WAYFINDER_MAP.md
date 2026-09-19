# AgentForge Wayfinder map

**Audit date:** 2026-09-19 (America/Chicago)
**Mode:** read-only code-boundary and implementation-claim audit.
**Tracker:** GitLab issues and draft merge requests in the private staging project;
this Markdown map remains the evidence index.
**Controlling boundary:** synthetic-only, read-only, clinician-reviewed. No PHI
or clinical write-back. The selected Vultr runtime records the Alibaba-compatible
Qwen3.6 Flash lane activated for authorized no-PHI synthetic evaluation and the
seeded synthetic OpenEMR read-only path. The current stack is published as three
draft merge requests; it is not merged into the protected group project.

## Destination

A verified implementation-and-evidence map from the original Week 1 assignment
to the current AgentForge behavior, with every remaining implementation claim
anchored to code and every unresolved design or owner choice expressed as a
decision ticket. The route is clear only when no new implementation should begin
behind an unresolved contract, authorization, provider, readiness, dashboard,
or deployment-evidence decision.

## Why the map stops before merge

The current stack is locally verified, deployed to the selected synthetic Vultr
runtime, and published to a private staging project as draft merge requests.
PHP is not available for executable Node/PHP HMAC parity, and the selected
runtime proof remains limited to synthetic/read-only behavior. The merge requests
remain draft review checkpoints; merge into a shared target and any broader
release claim require separate owner review. This separation prevents a green
local test run or a narrow deployment observation from being presented as PHI,
production, or clinical-safety evidence.

## Notes

- The original brief was read from `C:\Users\david\.codex\worktrees\3ef3\agentforge-week1\Week 1 - AgentForge.pdf`; `docs/agentforge/REQUIREMENTS.md` is a transcription, not the source.
- The active checkout is `davidslayback/agentforge-stack-03-deploy-evidence` at `b350ced`; the working tree is clean. The implementation stack is published in the private `davidslayback/agentforge-week1-staging` project.
- The former `.scratch/overnight/` queue is summarized in [`HISTORICAL_QUEUE_SUMMARY.md`](HISTORICAL_QUEUE_SUMMARY.md) and retired; it must not define new implementation.
- The current execution source is GitLab issues [#1](https://labs.gauntletai.com/davidslayback/agentforge-week1-staging/-/work_items/1), [#2](https://labs.gauntletai.com/davidslayback/agentforge-week1-staging/-/work_items/2), and [#3](https://labs.gauntletai.com/davidslayback/agentforge-week1-staging/-/work_items/3), with stacked draft MRs [!65](https://labs.gauntletai.com/davidslayback/agentforge-week1-staging/-/merge_requests/65), [!66](https://labs.gauntletai.com/davidslayback/agentforge-week1-staging/-/merge_requests/66), and [!67](https://labs.gauntletai.com/davidslayback/agentforge-week1-staging/-/merge_requests/67). The older program #17/#18–#26 references are historical.
- Evidence labels below mean: **code** = current source readback; **local** = repository tests/evidence; **runtime** = external deployment observation; **owner** = a human decision or custody/readback requirement.

## Decisions so far

- The live path has an OpenEMR REST adapter, launcher-side `pid`→UUID lookup, a server-only OAuth user-context token, and a seeded synthetic OpenEMR corpus; fixture retrieval remains only the local deterministic fallback. [`openemrAdapter.js`](../../agentforge/src/openemrAdapter.js:4-129), [`index.php`](../../interface/modules/custom_modules/oe-module-agentforge/public/index.php:1-40)
- The current local/default provider is deterministic, while Vultr runs an authorized Qwen3.6 Flash synthetic evaluation lane through the Alibaba-compatible Responses endpoint. It is not funded, BAA-covered, or PHI-approved. [`server.js`](../../agentforge/src/server.js:14-18), [`DECISIONS.md`](DECISIONS.md:241-258)
- Responses are intended to be evidence-backed and read-only. Authorization failure blocks; partial/failed coverage qualifies or withholds output; no chart mutation operation is exposed in the AgentForge service. [`service.js`](../../agentforge/src/service.js:31-85), [`verifier.js`](../../agentforge/src/verifier.js:1-60)
- The assignment matrix is the coverage index; the current matrix marks synthetic behavior as done only for the checkpoint and marks live OpenEMR, live dashboard proof, current-candidate deployment proof, and scale/cost closure partial, missing, blocked, or deferred. [`REQUIREMENTS_MATRIX.md`](REQUIREMENTS_MATRIX.md:7-57)
- **WF-01 resolved:** `agentforge/src/contracts.js` is the executable source of truth for request/response fields, and `ARCHITECTURE.md` now describes that contract. Comparison baseline and visit mode are server-owned details, not request fields.
- **WF-02 resolved:** briefing and follow-up paths require server-verified signed context. Body `authorization` is not part of the request contract or runtime authorization path. Redacted operational endpoints are a separate metadata surface. The local B revision additionally makes live-adapter issuer/session/role requirements strict by default; selected runtime paths now have fresh synthetic Vultr readback, while real OpenEMR identity/session parity remains outstanding.
- **WF-03 resolved:** resilience is request-level retry plus deterministic fallback; readiness still reports a configured provider outage as not ready. Deterministic-only mode is ready. Fallback availability must not conceal dependency health.
- **WF-04 resolved:** retrieval records must be coverage-scoped. Failed, timed-out, or unauthorized groups contribute no usable records; empty groups contribute no records; dependent claims are withheld and the result is qualified.
- **WF-05 platform updated by ADR-016:** use AgentForge-lite for the current synthetic demo: local redacted traces, metrics, alerts, and the existing operational page. Retain the Langfuse OTLP exporter as an optional adapter; defer self-hosted Langfuse until a larger host or a hosted-project decision is made.

## Current code map

| Assignment area | Current behavior and owner | Evidence status | Boundary / claim consequence |
| --- | --- | --- | --- |
| Conversational return-visit workflow | `AgentForgeService.prepare()` and `followUp()` orchestrate briefing, cache continuity, stale refresh, deadlines, and patient/clinician checks. [`service.js`](../../agentforge/src/service.js:23-85), [`service.js`](../../agentforge/src/service.js:87-145) | code + 49/49 AgentForge tests + historical synthetic Vultr browser E2E | Supports synthetic behavior and prior deployed read-only retrieval; not proof of current-candidate parity, clinician usefulness, or production safety. |
| Retrieval and coverage | `OpenEMRRestAdapter` uses only GET allowlisted REST routes and normalizes records; `FixtureAdapter` remains a local deterministic fallback. [`openemrAdapter.js`](../../agentforge/src/openemrAdapter.js:4-129), [`fixtureAdapter.js`](../../agentforge/src/fixtureAdapter.js:3-26) | code + adapter/mutation tests + seeded synthetic Vultr E2E | Synthetic OAuth-authorized retrieval and browser readback are proven; production identity, PHI, and compliance are not. |
| Verification | Claims carry source/evidence; verifier checks patient scope, read operations, coverage, qualification, provenance, conflicts, stale data, and generated text. [`service.js`](../../agentforge/src/service.js:60-72), [`verifier.js`](../../agentforge/src/verifier.js:1-60) | code + golden/mutation tests | Supports evidence discipline, not clinical correctness or production safety. |
| Authorization and patient scope | Signed context binds patient, clinician, scope, issuer, authentication method, role, read ACL, and expiry; verified contexts are immutable and expiry is rechecked at authorization time. Body `authorization` is rejected by the canonical contract. [`accessContext.js`](../../agentforge/src/accessContext.js:1-145), [`contracts.js`](../../agentforge/src/contracts.js:24-165), [`server.js`](../../agentforge/src/server.js:31-57) | code + synthetic auth/contract tests + 2026-09-19 Vultr synthetic briefing readback | B is implemented and the selected runtime paths now have fresh synthetic deployment evidence. Real OpenEMR role/session parity, PHP executable parity, and production authorization remain unproven. |
| OpenEMR integration seam | Fork REST routes authorize patient, encounter, medication, allergy, and document reads; the module resolves the selected session PID to the actual patient UUID, and the Node adapter calls the corresponding read routes. [`_rest_routes_standard.inc.php`](../../apis/routes/_rest_routes_standard.inc.php:76-109), [`_rest_routes_standard.inc.php`](../../apis/routes/_rest_routes_standard.inc.php:253-325), [`_rest_routes_standard.inc.php`](../../apis/routes/_rest_routes_standard.inc.php:504-510), [`index.php`](../../interface/modules/custom_modules/oe-module-agentforge/public/index.php:1-40), [`openemrAdapter.js`](../../agentforge/src/openemrAdapter.js:4-129) | code + fake-HTTP seam tests + selected current Vultr synthetic briefing readback | The current selected runtime is proven on the synthetic seam; production identity/session semantics, PHP runtime parity, and PHI authorization remain out of scope. |
| Provider behavior | Deterministic provider is default locally; historical Vultr evidence records an authorized synthetic Qwen3.6 Flash lane through `ResilientProvider`, which validates output and falls back deterministically. [`modelProvider.js`](../../agentforge/src/modelProvider.js:1-129) | code + provider tests + historical no-PHI Vultr smoke | Historical generation/readiness passed; provider terms, retention, cost, and PHI suitability remain open. |
| Health/readiness | `/health` is process liveness; `/ready` calls the selected OpenEMR adapter, model, and trace checkers. [`server.js`](../../agentforge/src/server.js:16-25), [`index.js`](../../observability/index.js:274-293) | code + local readiness/live-mode boundary tests + 2026-09-19 Vultr readback | Current selected Vultr runtime returned 200 for `/health` and `/ready`; readiness is dependency/configuration evidence, not provider-quality, PHI, or production proof. |
| Observability | Redacted traces persist locally or to a configured file; an optional Langfuse v4 OTLP exporter sends an explicit operational allowlist; metrics expose requests/errors/latency/retries/fallbacks/verification/display outcomes plus exporter queue/drops/status; HTML page reads JSON metrics, alerts, and traces. [`index.js`](../../observability/index.js:158-365), [`server.js`](../../agentforge/src/server.js:28-55) | code + 13/13 observability tests + 72/72 combined | AgentForge-lite is the current demo surface. The exporter is fail-safe, bounded, and not part of readiness. Self-hosted Langfuse is deferred; no external dashboard readback is claimed. |
| Alerts | Deterministic p95, error-rate, and tool-failure rules are evaluated by `/v1/alerts`; response guidance is documented. [`index.js`](../../observability/index.js:264-272), [`OBSERVABILITY.md`](OBSERVABILITY.md:11-32), [`INCIDENT_RESPONSE.md`](OBSERVABILITY.md:6-55) | code + local drill | Alert evaluation exists; time-window and delivery semantics remain open. |
| Contracts | Strict unknown-field validators live in `contracts.js`; `ARCHITECTURE.md` and the API collection describe the same signed-context request shape. [`contracts.js`](../../agentforge/src/contracts.js:5-75), [`api/README.md`](../../agentforge/api/README.md:3-25) | code + contract/eval tests + PowerShell parse | The executable validator remains authoritative; no body authorization, arbitrary mode, or client-supplied baseline fields are accepted. |
| Load and cost | Reports and planning model describe deterministic synthetic runs, one host, account-level billing, and tiered architecture envelopes. [`COST_MODEL.md`](COST_MODEL.md:6-69), [`LOAD_TEST.md`](LOAD_TEST.md:1-30) | deferred | Revisit only after a live conversational agent exists; do not spend review effort on synthetic capacity or unattributed billing now. |
| Deployment and release | Vultr and Railway artifacts coexist; the current published stack is `b350ced` and the selected Vultr runtime has same-day synthetic readback. [`PROJECT_EXPLAINER.md`](PROJECT_EXPLAINER.md:43-69), [`HISTORICAL_QUEUE_SUMMARY.md`](HISTORICAL_QUEUE_SUMMARY.md) | runtime evidence is candidate-scoped | The stack is reviewable but not merged; PHI, production identity, external dashboard, and clinical-safety claims remain out of scope. |

## Cleanup and claim findings

1. **Contract reconciliation resolved:** `ARCHITECTURE.md` now matches `contracts.js`; the signed `demo_token` is the request-level context extension and body authorization is rejected.
2. **Resolved retry ownership:** `contracts.js` exports `MAX_RETRIES`, and `ResilientProvider` uses it as the default bounded retry budget. Tests cover retry exhaustion and fallback.
3. **Resolved readiness fallback leak:** a configured provider or live OpenEMR access-token outage returns not-ready; fallback availability does not claim dependency health.
4. **Authorization contract:** body `authorization` was removed from the canonical request shape and runtime authorization path. Briefing/follow-up paths require a server-verified signed context; redacted operational endpoints are a separate metadata surface. The selected runtime paths now have fresh synthetic Vultr readback; real OpenEMR identity/session parity remains outstanding.
5. **Remaining live-boundary gap:** the seeded synthetic OAuth/read-only REST and browser flow is externally proven; production role/session semantics, PHI authorization, and compliance are not.
6. **Dashboard mismatch:** the `/observability` browser page is a JSON-backed operational view, not the clinician conversational UI. Queue depth is always `0` in the serving sink, while a separate in-memory registry is only exercised by tests. The assignment’s live dashboard requirement is therefore not closed by endpoint existence.
7. **Stale deployment language:** `AUDIT.md` retains earlier self-signed/no-redirect findings while later Vultr artifacts describe trusted HTTPS. Preserve the historical audit, but mark or reconcile its deployment snapshot before using it as current evidence.
8. **Evidence-to-code boundary:** the selected runtime slice has same-day Vultr readback and the exact stack is published for review, but the proof is limited to synthetic/read-only behavior. None of this proves PHI readiness, a real external dashboard, production capacity, or clinician usefulness.

## Not yet specified

- Whether the current synthetic user-context OAuth flow is sufficient for any future production-approved identity/role boundary.
- How synthetic seed/rollback custody should be documented and reproduced in future environments.
- External consumer review and versioning of the now-reconciled request/response contract.
- Whether the required dashboard must be an external observability product or whether a deployed browser/JSON surface is acceptable, and how queue depth is measured.
- Whether the current `b350ced` stack and selected Vultr runtime should be treated as the final assignment candidate after review.
- Provider/model budget, retention/deletion, and data-processing terms for any scope beyond the authorized synthetic Qwen3.6 lane.
- Load, scale, and cost interpretation. These remain deferred until a live conversational agent exists.
- Langfuse same-VM capacity disposition: the owner-controlled Vultr VM is 2 vCPU/3.8 GiB RAM/75 GiB disk, below Langfuse's published 4-core/16-GiB VM guidance; activation requires a larger VM or explicit demo-only risk acceptance.

## Out of scope

- PHI, clinical write-back, recommendations, diagnoses, orders, provider activation beyond the authorized synthetic candidate, BAA/compliance approval, or production certification.
- PHI, clinical write-back, broader provider activation, merge into shared targets, and production certification.

## Decision tickets

### WF-01 — Select the canonical AgentForge contract — RESOLVED

**Question:** Which request/response fields are authoritative, and which documents/tests must consume that single contract?

**Dependencies:** none. **Type:** HITL decision. **Verifier:** contract reviewer.

**Evidence required:** executable contract export or schema; reconciled `ARCHITECTURE.md` example; API collection readback; tests proving accepted/rejected fields; explicit record that `current_visit_at` and `mode` are rejected while `case_id` and `demo_token` are supported where applicable.

**Stop condition:** no new endpoint or UI contract work until prose, validator, collection, and eval fixtures agree.

**Resolution:** Use `contracts.js` as the authority because it is enforced at the HTTP boundary and covered by tests/API probes. Keep the current request surface unchanged; revise the architecture example to match it before implementation expands.

### WF-02 — Enforce the signed user-context authorization mode — RESOLVED

**Question:** Is server-verified signed user context mandatory for briefing and follow-up paths, with no request-body authorization fallback?

**Dependencies:** WF-01. **Type:** HITL decision. **Verifier:** authorization boundary reviewer.

**Evidence required:** environment readback; negative tests for missing/expired/mismatched/non-read context; module launcher review showing patient/session/ACL binding; statement that fixture mapping is not live authorization.

**Stop condition:** do not widen any OpenEMR or deployment claim while signed-context deployment readback and identity/session parity remain unverified.

**Resolution:** Require server-verified signed context for briefing and follow-up paths. Remove body `authorization` from the canonical request contracts, UI, evaluation runner, and service fallback. Future deployment verification must prove signed context is active; redacted operational endpoints remain a separate metadata surface.

### WF-03 — Define readiness semantics for configured providers — RESOLVED

**Question:** Should `/ready` fail when a configured primary provider is unavailable, even if deterministic fallback can serve synthetic output?

**Dependencies:** WF-01, WF-02. **Type:** HITL decision. **Verifier:** readiness test reviewer.

**Evidence required:** decision table for deterministic-only, configured-and-ready, configured-but-missing-key, timeout, and fallback cases; black-box `/ready` responses; trace showing fallback behavior; updated requirement mapping.

**Stop condition:** no readiness “done” claim until the dependency semantics match the assignment interpretation and deployed behavior.

**Resolution:** Keep two bounded retries, validate the candidate output, then use the deterministic provider as a visible synthetic fallback. If a provider is configured but unavailable, `/ready` remains `503`/`not_ready`; this prevents the fallback from falsely claiming that the configured dependency is healthy. Deterministic-only mode may report ready.

### WF-04 — Close retrieval coverage and claim withholding at the adapter boundary — RESOLVED

**Question:** Must the adapter return only records supported by successful coverage groups, rather than relying on fixture `withhold_fields` to prevent claims from failed groups?

**Dependencies:** WF-01, WF-02. **Type:** HITL design decision. **Verifier:** safety/evidence reviewer.

**Evidence required:** group-to-record mapping; mutation cases where a failed group has a record present in the fixture; proof that dependent claims and patient identity are withheld; read-only operation allowlist mapped to the cited OpenEMR routes.

**Stop condition:** no live-adapter planning or stronger retrieval claims while coverage semantics can depend on fixture-specific expected fields.

**Resolution:** The adapter boundary must return records already associated with successful coverage groups. The service must not infer safe withholding solely from fixture `expected.withhold_fields`; failed/timeout/unauthorized groups must be incapable of supplying claims, while successful groups remain usable and empty groups remain explicit no-data outcomes.

### WF-05 — Define the assignment dashboard and alert proof

**Question:** What exact deployed surface satisfies the live dashboard requirement, and what are the measurement windows and ownership semantics for queue depth, p95, errors, retries, verification, and tool failures?

**Dependencies:** WF-01, WF-03. **Type:** HITL decision. **Verifier:** observability reviewer.

**Evidence required:** requirement-to-widget mapping; deployed browser readback; actual queue-depth source; p50/p95/p99 and bounded-window definitions; three alert rules plus response owner and delivery/readback proof.

**Stop condition:** endpoint existence or a static HTML page cannot alone close the dashboard requirement.

**Platform decision:** Use AgentForge-lite for this single-VM synthetic checkpoint. It keeps the local redacted trace sink and operational page authoritative, exposes bounded exporter queue state, and retains a standard OTLP adapter for a future hosted or resized Langfuse deployment. Do not send raw chart text, prompts, responses, or PHI-shaped content.

### WF-06 — Freeze deployment candidate and evidence custody

**Question:** Which target, URL, commit/image, and evidence bundle constitute the current candidate for assignment claims?

**Dependencies:** WF-01 through WF-05 as applicable. **Type:** HITL owner gate. **Verifier:** clean-profile deployment reviewer.

**Evidence required:** target readback; exact source/image identity; trusted TLS and redirect; clean-browser briefing/follow-up/partial/blocked flow; API collection; evals; observability; `/health` and `/ready`; timestamps and artifact custody.

**Stop condition:** Railway, Vultr, local, and historical evidence must not be combined into one completion state.

### WF-07 — Resolve provider and data-processing policy — SYNTHETIC LANE RESOLVED

**Question:** Is a hosted/provider lane authorized for synthetic data, with what model, retention, failure behavior, and terms? Broader PHI/production use remains a separate decision.

**Dependencies:** WF-03, WF-06. **Type:** HITL decision. **Verifier:** provider/data-boundary reviewer.

**Evidence required:** explicit provider/model selection or deferral; retention/deletion policy; provider readiness and trace semantics; explicit synthetic-only boundary.

**Resolution:** Authorize Alibaba-compatible Qwen3.6 Flash only for no-PHI synthetic Vultr evaluation. Keep deterministic as the local/default fallback; do not infer PHI approval, production suitability, or broad data-processing acceptance. The provider key remains server-only and absent from repository, browser, traces, and prompt data.

**Stop condition:** the synthetic activation does not authorize PHI, clinical write-back, or production certification.

### WF-08 — Retire or supersede the historical execution queue — RESOLVED

**Resolution:** Retire `.scratch/overnight/` as an active source. Extract its relevant dependencies, ticket themes, historical statuses, and evidence interpretation into `HISTORICAL_QUEUE_SUMMARY.md`; use the current GitLab issues and stacked merge requests listed above, mapped to the current requirements matrix, for future work.

**Dependencies:** WF-01 through WF-07. **Type:** HITL planning decision. **Verifier:** requirements/claims reviewer.

**Evidence required:** one source-of-record statement; ticket-to-requirement mapping; explicit preservation of useful evidence; no ticket marked advanced solely because its historical file says verified; new tickets each name dependencies, verifier, and evidence.

**Evidence:** the summary file records the retired source, the preserved planning intent, the current source-of-truth documents, and the explicit deletion of the old queue.

## Verification run recorded for this map

`node --test agentforge/test/*.test.js evals/test/*.test.js observability/test/*.test.js` passed **72/72** on 2026-09-19, including **49/49** AgentForge tests and **13/13** observability tests. Same-day Vultr readback also passed for the selected runtime slice: health/readiness/dashboard 200 and one synthetic briefing complete/verified. This still does not prove PHP executable parity, PHI readiness, production role semantics, compliance, or merge/release readiness.
