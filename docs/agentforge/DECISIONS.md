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
- **Limitation:** The hosted endpoint currently uses an IP and internal/self-
  signed TLS rather than trusted production TLS.
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
