# AgentForge architecture

## Executive summary

AgentForge is a separate, read-only service that prepares a primary-care
physician for a returning patient's visit. OpenEMR remains the system of
record. A thin OpenEMR launcher supplies a short-lived, synthetic demo context
to the service; it does not authorize access by putting a patient ID in a URL.
The service owns scoped context validation, retrieval, reconciliation,
evidence-grounded generation, response verification, conversation state, and
redacted local traces.

The early slice uses a fixture retrieval adapter and a provider-neutral model
interface. A live model is used when configured, while deterministic mode
provides reproducible evaluations and a provider-outage fallback. The adapter
boundary is deliberate: the clinical rules and evaluation oracles must remain
stable when fixture data is replaced with the narrowest audited OpenEMR
read-only integration.

The initial deployment adds an AgentForge container beside the existing
OpenEMR and MariaDB services. It may use a separate public port during the
checkpoint. Same-origin proxying is a later hardening step after routing,
cookie, TLS, and authorization behavior are measured. This avoids coupling
the agent to OpenEMR's PHP internals while preserving a credible path to an
embedded final experience.

The service fails closed when identity or authorization cannot be established.
It distinguishes empty results, no prior encounter, stale or missing
provenance, unauthorized access, timeout, and retrieval failure. A partial
briefing may show supported evidence, but it is qualified as incomplete and
withholds conclusions dependent on unavailable evidence. Each operation has
at most two retries within an overall deadline.

## Capability traceability

| Capability | Use cases | Early implementation | Final migration |
| --- | --- | --- | --- |
| Visit briefing | UC-1, UC-5 | Fixture retrieval and scoped service API | Narrow OpenEMR adapter and same-origin embed |
| Concern follow-up | UC-2 | Conversation API with retained patient/baseline context | Authenticated OpenEMR evidence retrieval |
| Plan follow-through | UC-3 | Evidence-linked fixture query | Cross-record OpenEMR retrieval |
| Conflict explanation | UC-4 | Fixture conflict/resolution oracle | Audited provenance and resolution rules |
| Incomplete-record handling | UC-5 | Coverage ledger, qualification, bounded retry | Measured API timeout and queue policy |
| Evidence inspection | UC-1–UC-5 | Evidence IDs, dates, authors, excerpts | Links to authorized OpenEMR records |
| Safety and authorization | UC-1, UC-5 | Demo context validation and fail-closed verifier | OpenEMR clinician/session and patient-scope checks |
| Conversation isolation | UC-2–UC-5 | Conversation keyed by active patient context | Authenticated session binding and cache invalidation |
| Observability | UC-1–UC-5 | Correlation IDs and redacted local traces | Retention, deletion, alerting, and incident workflow |

## Service boundaries and contracts

- `RetrievalAdapter` returns normalized evidence objects and a coverage ledger;
  it never returns model instructions.
- `ModelProvider` accepts scoped evidence and constrained instructions, and
  returns text plus usage metadata. Provider credentials stay server-side.
- `Verifier` checks that displayed claims reference retrieved evidence, retain
  provenance and dates, respect coverage, stay within read-only clinical
  authority, and do not mix patients.
- `TraceSink` records stage outcomes, timing, retries, coverage, verification,
  and usage metadata. Raw chart text is excluded by default.
- The public API exposes health/readiness, briefing creation, and follow-up
  message operations. Every patient-scoped operation carries a correlation ID
  and opaque context/session identifier.

## Failure and deployment model

Health reports process availability only. Readiness checks the configured
retrieval source, model provider, and trace sink. Authorization failure blocks
briefing display. Retrieval failure produces a qualified result or a bounded
retry outcome; successful empty retrieval remains a valid empty result.

The current Vultr stack has OpenEMR and MariaDB. The checkpoint adds AgentForge
as a third container using synthetic data only. Before PHI, replace the demo
context, add same-origin proxying and trusted TLS, implement the audited
OpenEMR adapter, define retention/deletion and provider controls, and rerun
authorization and recovery tests.

## Decision records for interview discussion

1. **Separate service over native PHP module.** This isolates agent logic,
   makes provider and retrieval adapters replaceable, and avoids coupling the
   safety boundary to a large PHP monolith. The tradeoff is an initial context
   bridge and deployment hop.
2. **Launcher now over same-origin proxy now.** A proxy is the better final
   browser surface, but adding it tonight would combine untested routing,
   TLS, cookies, and headers with the new agent. The launcher preserves the
   intended workflow while making the proxy a bounded follow-up.
3. **Live provider plus deterministic mode.** The live provider demonstrates
   real agent behavior; deterministic mode makes safety evaluation reproducible
   and protects the demo from provider failure.
4. **Fixture adapter before OpenEMR adapter.** Fixtures exercise edge cases that
   the tiny demo database does not contain. The adapter contract preserves the
   path to real read-only retrieval without prematurely exposing broad APIs.
5. **Read-only, physician-reviewed output.** The audit and user decisions make
   evidence surfacing safer and more defensible than generated chart writes or
   new clinical recommendations.
6. **Verification before display.** Grounding and domain checks are a display
   gate, not a claim that the underlying chart is clinically true.
7. **Local/redacted traces.** Traces need reconstruction value without making
   raw patient content the default observability payload.
8. **Two retries plus deadline.** Bounded recovery fits the pre-visit workflow
   while preventing indefinite waiting and making failures measurable.

Each decision is reversible through the migration steps above, and each is
validated by the corresponding contract, evaluation, or deployment test.
