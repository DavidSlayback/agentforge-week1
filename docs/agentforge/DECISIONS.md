# AgentForge decision log

This is the running interview and implementation decision record. It captures
decisions from the audit, grilling/planning sessions, and checkpoint work. Each
entry states the choice, alternatives, tradeoff, evidence, limitation, and
migration path.

## ADR-001: Separate service boundary

- **Choice:** Keep AgentForge as a separate service beside OpenEMR, with a thin
  custom-module launcher.
- **Alternatives:** Native PHP module containing orchestration; direct model
  calls from OpenEMR routes.
- **Tradeoff:** Adds deployment and network seams, but isolates verification,
  provider replacement, and retrieval adapters from the OpenEMR monolith.
- **Evidence:** The audit found mixed read/write OpenEMR routes and differing
  identifier shapes; the architecture requires an allowlisted normalized
  adapter.
- **Limitation:** The checkpoint adapter is fixture-backed, not a live chart
  adapter.
- **Migration:** Implement an authenticated OpenEMR adapter behind the same
  retrieval contract after session binding and PHI controls are reviewed.

## ADR-002: Launcher plus same-origin routing

- **Choice:** Use a module launcher for patient context and Caddy path routing
  under `/agentforge`; do not expose the AgentForge port as the browser seam.
- **Alternatives:** Direct cross-origin browser calls to port 8787; a native
  same-origin PHP proxy.
- **Tradeoff:** Caddy adds one deployment component, while the launcher keeps
  OpenEMR-specific context handling small and replaceable.
- **Evidence:** Direct public service exposure was unreliable; the Caddy route
  made health, readiness, and briefing requests reachable through one origin.
- **Limitation (historical snapshot):** Earlier hosted evidence used an IP and
  internal/self-signed TLS rather than trusted production TLS. Later Vultr
  evidence records trusted HTTPS and an HTTP redirect, but that evidence is
  tied to a different candidate than the active local branch; see the claim-
  consistency Wayfinder ticket.
- **Migration:** Move to a real domain, trusted certificates, redirect HTTP to
  HTTPS, and bind the launcher to the authenticated session server-side.

## ADR-003: Deterministic provider before live model

- **Choice:** Make the deterministic provider the default and keep an
  OpenAI-compatible provider behind the same interface.
- **Alternatives:** Start with a hosted model; test only mocked model calls.
- **Tradeoff:** Less generative realism now, but reproducible safety evaluation
  and zero provider/PHI exposure during the checkpoint.
- **Evidence:** The product boundary is read-only and clinician-reviewed;
  provider retention, BAA, and PHI decisions are not complete.
- **Limitation:** Model quality and hosted-provider latency are not evaluated.
- **Migration:** Add a provider-specific evaluation lane and compliance review
  before sending any patient data to a hosted model.

## ADR-004: Fixture adapter before OpenEMR adapter

- **Choice:** Prove the domain contract, verifier, evals, and traces against
  seven synthetic cases before connecting live records.
- **Alternatives:** Build the OpenEMR API integration first; use ad hoc demo
  records without a corpus.
- **Tradeoff:** Delays live integration, but makes missing, conflicting, stale,
  untrusted-note, duplicate, and partial-retrieval behavior reproducible.
- **Evidence:** The audit identified source quality, identifier, and coverage
  risks before implementation.
- **Limitation:** Fixture success does not establish OpenEMR retrieval parity.
- **Migration:** Add contract-parity tests comparing fixture and OpenEMR adapter
  outputs without changing the verifier or model interface.

## ADR-005: Read-only clinical boundary

- **Choice:** AgentForge may retrieve and summarize evidence but cannot write
  notes, diagnoses, medications, orders, appointments, or messages.
- **Alternatives:** Allow write-back for a more complete demo; expose general
  OpenEMR tools and rely on prompting.
- **Tradeoff:** Smaller visible product surface, substantially smaller clinical
  and authorization risk.
- **Evidence:** The agreed workflow is physician preparation; the physician
  remains the decision-maker.
- **Limitation:** Follow-through is surfaced, not executed.
- **Migration:** Treat write capability as a separate governed product with new
  authorization, confirmation, audit, and evaluation requirements.

## ADR-006: Verification before display

- **Choice:** Verify patient scope, evidence grounding, coverage qualification,
  and read-only operations before returning a displayable briefing.
- **Alternatives:** Display model output with warnings; verify only selected
  high-risk claims.
- **Tradeoff:** Some useful output is withheld or qualified, but unsupported or
  cross-patient content cannot silently reach the clinician panel.
- **Evidence:** Patient mixing, discrepancy resolution, and partial retrieval
  are explicit critical failure modes in the evaluation gate.
- **Limitation:** The current verifier is intentionally narrow and deterministic.
- **Migration:** Extend the contract and independent oracles as new use cases
  are accepted; never bypass the display gate for a new provider.

## ADR-007: Local redacted observability

- **Choice:** Record bounded, redacted traces locally, with stage timing,
  retrieval attempts, retries, model usage, verification, display outcome, and
  aggregate metrics.
- **Alternatives:** Raw application logs; hosted telemetry from day one; no
  observability until production.
- **Tradeoff:** Limited retention and dashboard sophistication, but lower data
  exposure while still supporting reconstruction and failure analysis.
- **Evidence:** The requirement calls for correlation IDs and actual-run
  ordering/timing while PHI handling remains out of scope.
- **Limitation:** The checkpoint store is in-memory and the dashboard is
  intentionally minimal; restart loses traces.
- **Migration:** Add a reviewed local persistent sink, retention/deletion rules,
  alerts, and only then consider external telemetry.

For the deployed Railway checkpoint, ADR-009 supersedes the in-memory limitation
with the implemented file-backed sink and attached-volume configuration.

### ADR-009: Railway attached-volume trace persistence

- **Choice:** Keep traces redacted and local to the service boundary, but use
  the implemented file-backed sink with Railway
  `AGENTFORGE_TRACE_PATH=/data/traces.json` on an attached volume for the
  deployed synthetic checkpoint.
- **Alternatives:** Keep the default `/tmp` store; add hosted telemetry; add a
  second deployment provider through Vultr.
- **Tradeoff:** The volume proves persistence across the exercised redeploy
  without adding a provider boundary, but it is not cross-region durability or
  an off-host backup system.
- **Evidence:** Railway volume `agentforge-week1-volume` is mounted at `/data`,
  and correlation `af-1789742039771-a2a58e89b05cb8` survived the confirmed
  redeploy with its patient scope redacted.
- **Migration:** Add scheduled/off-host backup and restore, external alert
  delivery, and secret-manager readback only if the scope moves beyond the
  synthetic checkpoint.

## ADR-008: Independent service-backed eval lane

- **Choice:** Keep reference-fixture evaluation for oracle regression and add a
  second mode that sends every case through the running service before applying
  the same independent oracles.
- **Alternatives:** Test only internal functions; evaluate only hand-authored
  reference responses; use provider-specific qualitative review.
- **Tradeoff:** Slightly more runtime and process orchestration, but it detects
  wiring, serialization, routing, and service behavior regressions.
- **Evidence:** The checkpoint requirement is an executable evaluation
  framework, and the live service is the delivered artifact.
- **Limitation:** Seven synthetic cases do not establish load, provider, or live
  OpenEMR performance.
- **Migration:** Add cases by contract and add deployed load/economic suites at
  the final deadline without weakening the critical gate.

## ADR-009: Match the deployed OpenEMR module seam explicitly

- **Choice:** Keep the launcher dependent only on the module-loader-injected
  event dispatcher and the deployed release's `SessionWrapperFactory` API;
  generate the short-lived handoff token server-side from the authenticated
  session, using the service's base64url HMAC contract.
- **Alternatives:** Depend on newer OpenEMR kernel helpers; accept a patient ID
  in the browser URL; or let the browser construct the authorization token.
- **Tradeoff:** The module contains a small compatibility seam and the demo
  remains synthetic, but the deployed integration is testable without making
  URL context an authorization decision.
- **Evidence:** The hosted OpenEMR release exposes the dispatcher in bootstrap
  scope and provides `getWrapper()`, not the newer helper methods assumed by an
  initial implementation. The live launcher now produced a signed context and
  a qualified briefing for the synthetic patient.
- **Limitation:** The PID-to-fixture mapping is explicitly demo-only and does
  not prove OpenEMR retrieval or production authorization parity.
- **Migration:** Replace the fixture mapping with an audited server-side
  patient adapter and add release-compatibility tests before any PHI trial.

## ADR-010: Synthetic forever, production-grade controls

- **Choice:** Keep AgentForge permanently synthetic, fixture-backed, and
  read-only. Do not ingest real PHI or connect to a live clinical record
  system. Build the same trust-boundary, failure-isolation, recovery,
  retention, redaction, and operational controls expected of a real platform,
  but exercise them against synthetic data and simulated external seams.
- **Alternatives:** Introduce real PHI for realism; or keep the deployment as a
  lightweight demo without production-like resilience.
- **Tradeoff:** The product cannot claim clinical or HIPAA validation, but the
  safety and resilience behaviors remain reproducible without exposing people
  or records.
- **Evidence:** Owner decision recorded 2026-09-18 after the AF-07 gate.
- **Limitation:** Synthetic controls do not prove live OpenEMR authorization,
  vendor compliance, or clinical safety.
- **Migration:** Implement simulated session/patient binding, durable redacted
  telemetry, retention/deletion, backup/restore, rollback, incident response,
  credential rotation, and failure drills before expanding the demo surface.

## ADR-011: Defer live provider selection

> Superseded for the synthetic Vultr evaluation lane by ADR-014. The local
> default remains deterministic, and this does not authorize PHI processing.

- **Choice:** Keep the deterministic provider as the default and defer a live
  agent/provider until the resilience and evaluation lanes are ready. A low-
  cost approved vendor path, potentially through OpenRouter, remains a future
  adapter decision rather than current authorization.
- **Alternatives:** Add a hosted provider now for conversational realism; or
  omit the provider seam entirely.
- **Tradeoff:** Less realism in the current checkpoint, but no premature
  retention, data-processing, cost, or provider-failure commitment.
- **Evidence:** Owner decision recorded 2026-09-18; the approved vendor list is
  available for the later provider lane.
- **Limitation:** Provider quality, latency, and cost remain unmeasured.
- **Migration:** Add a provider-specific evaluation and failure-policy lane
  using synthetic inputs only, then choose a vendor and configuration under a
  separate HITL review.

## ADR-012: Simulated authenticated OpenEMR seam

- **Choice:** Implement the OpenEMR boundary as a server-verified signed
  synthetic session around the existing fixture adapter. The service binds
  patient, clinician, and `read-briefing` scope from the verified context;
  browser-supplied identifiers do not establish authorization.
- **Alternatives:** Keep trusting the request body; connect a live OpenEMR API;
  or create a second browser-only authorization path.
- **Tradeoff:** The synthetic seam exercises identity, expiry, scope, mismatch,
  and isolation behavior without PHI, but does not prove OpenEMR OAuth or
  release-specific permission parity.
- **Evidence:** `agentforge/src/accessContext.js`,
  `agentforge/src/openemrAdapter.js`, and the authenticated adapter tests.
- **Limitation:** `/v1/demo-context` is an explicitly synthetic context issuer;
  it is not an OpenEMR identity provider.
- **Migration:** Keep the same adapter contract for future simulated upstream
  work; do not replace it with live records under this scope.

## ADR-013: Provider retries with deterministic fallback

> The vendor-selection limitation below is superseded for the authorized
> no-PHI synthetic Vultr lane by ADR-014; broader hosted-provider approval
> remains open.

- **Choice:** Put an optional OpenAI-compatible provider behind a two-retry
  wrapper with a deterministic synthetic fallback. Record retry and fallback
  status in redacted traces; never display an unverified provider result.
- **Alternatives:** Make a hosted provider mandatory; silently swallow provider
  errors; or remove the provider seam until late release work.
- **Tradeoff:** The deployed checkpoint remains reproducible and resilient to a
  provider outage, while provider quality, cost, and terms remain unapproved.
- **Evidence:** `ResilientProvider` tests prove timeout retry and fallback;
  service traces retain the provider stage and retry events.
- **Limitation:** No hosted provider is approved for PHI or production use;
  the separate synthetic Qwen activation is governed by ADR-014.
- **Migration:** Select one approved vendor only after a data-processing,
  retention, cost, and failure-policy review using synthetic inputs.

## ADR-014: Activate Qwen3.6 Flash for the synthetic Vultr lane

- **Choice:** Configure the existing Vultr AgentForge container to use the
  Alibaba-compatible Responses endpoint with `qwen3.6-flash`, retaining the
  deterministic provider as the local/default fallback.
- **Alternatives:** Continue deterministic-only deployment; use the unavailable
  `qwen3.5-flash` model; or activate OpenRouter before its lane is evaluated.
- **Tradeoff:** The deployed synthetic path now exercises a real provider, but
  provider quality, cost, retention, and compliance remain unapproved for PHI.
- **Evidence:** The provider key listed 14 accessible models but not
  `qwen3.5-flash`; a no-PHI `qwen3.6-flash` probe succeeded over both supported
  wire shapes. Vultr `/health` and `/ready` returned 200 after activation, and
  the deployed provider code generated a response without exposing the key in
  traces.
- **Limitation:** This is a synthetic evaluation activation only. No PHI,
  clinical write-back, or provider-dependent production claim is authorized.
- **Migration:** Record budget, retention, data-processing, and failure-policy
  decisions before treating the provider lane as a broader release capability.

**Owner direction — 2026-09-19:** Keep the Qwen lane in place for the current
synthetic deployment despite its measured latency alerts. Do not switch the
runtime or relax the latency target yet; evaluate OpenRouter later as a
separate provider migration with fresh synthetic latency, cost, retention, and
failure-policy evidence.

## ADR-015: Model the production-grade OpenEMR trust boundary without PHI

- **Choice:** Choose the production-grade authorization direction while keeping
  AgentForge permanently synthetic, read-only, and clinician-reviewed. The
  future real-data seam must use a per-request OpenEMR user-context token or
  server-side session/role introspection; a shared service bearer token alone
  is not sufficient for a real-data authorization claim. The current VM lane
  will exercise this boundary with synthetic tokens or an introspection stub.
- **Alternatives:** Keep the signed launcher handoff as the final real-data
  authorization claim; or introduce live PHI to test the boundary.
- **Tradeoff:** This adds an explicit identity/role binding seam and more
  failure tests, while avoiding PHI and preserving deterministic local tests.
  It also means the current synthetic handoff remains evidence of a safe
  issuer seam, not proof of production session or ACL parity.
- **Evidence required:** user-context subject and scope binding; active-patient
  binding; expiry/revocation and role-denial tests; mismatched-patient and
  patient-switch tests; GET-only/read allowlist tests; synthetic VM E2E
  readback; and explicit separation of fixture, simulated OpenEMR, and live
  provider evidence.
- **Limitation:** No real-data enablement, PHI, chart mutation, or production
  authorization claim is authorized by this ADR.
- **Migration:** Implement the synthetic user-context contract behind the
  existing adapter boundary, then verify it independently before advancing
  the OpenEMR retrieval slice.

## ADR-016: Keep AgentForge observability in-process for the demo

- **Choice:** Use the existing redacted file trace sink, metrics endpoints,
  alert evaluator, and `/observability` page as the current operational
  observability solution. Keep the Langfuse OTLP exporter as an optional,
  server-configured adapter, but defer self-hosting Langfuse on the shared
  Vultr VM.
- **Alternatives:** Add the full self-hosted Langfuse Compose stack; deploy
  Tempo plus Grafana; or send synthetic traces to Langfuse Cloud immediately.
- **Tradeoff:** The in-process path adds no VM services and keeps redacted
  trace custody local, but it does not provide Langfuse's richer query and
  exploration UI. The exporter preserves a future standard OTLP path without
  making request correctness depend on an external backend.
- **Evidence:** `observability/index.js` exposes exporter queue depth, dropped
  exports, last export status, and configuration state through the existing
  metrics surface. The local test suite verifies bounded pressure; the current
  Vultr VM is 2 vCPU/3.8 GiB RAM, below Langfuse's published self-hosted VM
  guidance.
- **Limitation:** This is sufficient for the synthetic demo checkpoint, not a
  production observability, retention, on-call, or compliance claim.
- **Migration:** If a hosted dashboard becomes necessary, use the existing
  redacted OTLP exporter with an owner-approved Langfuse Cloud project or a
  resized dedicated host. Do not change the redaction contract or activate
  PHI processing as part of that migration.

## ADR-017: Require a visual dashboard and defer OpenRouter to finalization

- **Choice:** Build and browser-verify a visual operational dashboard as a
  required checkpoint deliverable. Keep the current Qwen3.6 Flash synthetic
  lane during dashboard implementation and validation; migrate to OpenRouter
  only at the final provider step.
- **Alternatives:** Treat the JSON observability page as sufficient, switch
  providers now, or broaden the project into PHI/clinical integration.
- **Tradeoff:** Dashboard work is additional implementation, while delaying
  the provider swap keeps current evidence stable and makes the final provider
  comparison explicit.
- **Boundary:** AgentForge remains synthetic-only, read-only, and
  clinician-reviewed. No PHI, live clinical records, or clinical write-back is
  in scope.
- **Evidence required:** A visual dashboard showing request volume, errors,
  p50/p95/p99 latency, retrieval/tool attempts, retries, queue depth,
  verification/display outcomes, provider fallback, bounded alert state, and
  three actionable alerts, driven by synthetic traffic and redacted metadata.
- **Migration:** After dashboard readback and final demo preparation, configure
  OpenRouter through the existing provider interface, rerun the synthetic
  evaluation and failure gates, and refresh the final evidence bundle.
