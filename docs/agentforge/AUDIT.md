# OpenEMR audit

## Executive summary

OpenEMR is a large PHP/MariaDB monolith with browser sessions, role and ACL checks, native REST, FHIR/SMART-on-FHIR, and audit logging. It is a capable clinical-record substrate, but its general-purpose surface is much broader than a safe read-only copilot needs. AgentForge should use a server-side adapter with a small read allowlist, explicit coverage groups, active-patient binding, normalized evidence objects, and no model-controlled URLs, SQL, methods, or write paths.

The deployment is live and healthy but not suitable for real PHI. The local compose stack exposes developer services, uses demo credentials, and contains a checked-in GitHub Composer credential that must be treated as compromised and rotated before publication. The Vultr stack uses generated credentials and keeps MariaDB internal, but HTTPS is self-signed, HTTP does not redirect to HTTPS, and `/composer.json` is public. Readiness reports `ready` while `oauth_keys` is false, so it does not prove OAuth/SMART readiness. No PHI should enter this host, repository, prompts, logs, or external observability.

The tested unauthenticated boundary is promising: health endpoints work; REST and FHIR resources return 401 without an API credential; and probes for `.env`, `.git`, config source, phpMyAdmin, and server-status did not expose contents. Web login succeeds, but its session does not authorize the API; the adapter must use the documented OAuth/API flow. Clinician authorization, patient binding, scope minimization, expiry, and write rejection remain unverified. OpenEMR’s audit log is active and patient-linked, but it is not an AgentForge trace contract; retention, redaction, and local-first handling remain design requirements.

The main integration boundary is the API dispatch layer and its route/controller services. Patient identity, encounters, SOAP/forms, problems, medications, documents, users, and audit events live in separate tables and resource services, so one endpoint cannot represent a complete visit. Retrieval must preserve timestamps, authors, source identifiers, and authorization context. A coverage ledger must distinguish successful empty results from failed, timed-out, unauthorized, and not-requested groups. The future UI should show evidence and uncertainty without writing back to the chart.

Operationally, there is no copilot-specific readiness contract, queue, rate-limit policy, rollback procedure, tracing schema, or evaluation suite. Asynchronous preparation may fit 30-minute visits, but a hard deadline and bounded retries still need measurement. Observability should record attempted operations, outcomes, timing, retries, and coverage while excluding raw PHI by default. The demo dataset is too small for meaningful data-quality conclusions: 3 patients, 3 encounters, 3 medical-problem entries, 1 medication, and no documents. Basic null and duplicate checks passed, but duplicate, conflict, stale, provenance, and unstructured-note fixtures were absent until the synthetic corpus was added. Readiness probes took about 0.74–1.49 seconds locally and 0.20–0.23 seconds publicly; agent preparation latency, query count, model time, retries, queueing, and deadline behavior remain unmeasured. There is no demonstrated LLM BAA, PHI retention/deletion policy, copilot breach workflow, or evidence that current defaults satisfy HIPAA safeguards. The adapter and fixtures must stay within these boundaries.

## Security audit

- Use only server-side, allowlisted read operations. Do not expose the general OpenEMR API to the model.
- Bind every request to the authenticated clinician, active patient, and permitted scope. Patient switching must invalidate the prior binding and trigger a fresh authorization check.
- Prohibit writes, model-generated URLs, SQL, arbitrary HTTP methods, and create/update/delete scopes.
- Treat chart text as untrusted evidence, not agent instructions.
- The development compose files expose developer tooling, phpMyAdmin, extra services, and hardcoded demo credentials. They must not be deployed publicly.
- A GitHub Composer credential is checked into development compose history. Treat it as compromised and rotate/revoke it before further publication or reuse.
- Live checks: OpenEMR and MariaDB were healthy; health endpoints returned 200; unauthenticated REST/FHIR returned 401; `.env`, `.git`, config source, phpMyAdmin, and server-status were not exposed. `/composer.json` returned 200 and should be restricted as unnecessary fingerprinting.
- The Vultr deployment uses a self-signed certificate, and HTTP serves the login flow instead of redirecting to HTTPS. Use a trusted certificate and HTTP-to-HTTPS redirect before any PHI.

## Performance audit

- Local readiness probes measured approximately 0.74–1.49 seconds; public HTTPS readiness probes measured 0.20–0.23 seconds. These are baseline health timings, not copilot latency.
- Measure retrieval latency, query count, database behavior, model time, retry cost, queueing, and end-to-end preparation before setting targets.
- Visits occur about every 30 minutes, so asynchronous preparation is viable, but each run needs a hard deadline and bounded retries. The agreed retry policy is two retries plus the deadline.
- Queue behavior, rate limits, alert thresholds, rollback, deployment cost, and observability storage remain unspecified.

## Architecture audit

- Core integration points are the API dispatcher, standard REST route/controller layer, FHIR route/controller layer, OAuth/SMART configuration, and existing OpenEMR session/ACL checks.
- Relevant data spans `patient_data`, `form_encounter`, SOAP/forms, `lists`, prescriptions, documents, users, and the `log` table. Standard REST and FHIR representations must be compared for completeness and provenance.
- OpenEMR readiness reports `ready` while `oauth_keys` is false; the future AgentForge readiness contract must separately verify its adapter, model provider, verification stage, and observability dependency.
- The future UI should present expandable sections, each beginning with a section-level BLUF, with inline citations that open supporting evidence.

## Data Quality audit

- Local demo counts: 3 patients, 3 encounters, 3 medical-problem entries, 1 medication, and 0 documents.
- Smoke checks found no duplicate `(fname, lname, DOB)` groups and no missing patient DOB, sex, or encounter dates. The sample is too small and clean to establish clinical-data quality.
- The field-level latest-value rule must preserve date, author, source identifier, and reassessment status. A newer record is not a reassessment unless the record explicitly documents reassessment.
- Conflicts must be exposed or withheld, not silently resolved. Missing provenance and stale values must be qualified. Failed, timed-out, unauthorized, empty, and not-requested retrieval groups must remain distinct.
- Seven synthetic cases cover complete data, duplicate identity, conflicting latest values, stale data, missing provenance, unstructured notes, and partial retrieval. They are in `docs/agentforge/fixtures/clinical-cases.json` and are not OpenEMR import data.

## Compliance & Regulatory audit

- This repository and classroom deployment do not establish HIPAA compliance, a risk analysis, minimum-necessary policy, incident-response plan, workforce controls, or recovery procedures.
- The local `log` table contained 2,183 rows, including 2,116 patient-linked rows and events for login, logout, viewing, patient-record changes, and HTTP requests. This does not yet cover AgentForge retrievals, prompts, model calls, verification failures, retries, deadlines, or disclosures.
- Define retention and deletion for prompts, model inputs/outputs, traces, caches, browser state, and error logs. Keep observability local-first and exclude raw chart content by default.
- Sending PHI to an LLM requires vendor suitability, a BAA where applicable, permitted-use and retention settings, encryption, access control, and breach procedures. No BAA or provider configuration is established here.
- Unverifiable claims must be withheld from the normal brief, with a heavily qualified explanation of what could not be verified. A partial brief may remain visible.
- Before PHI: rotate secrets, restrict SSH, use trusted TLS, test backup/restore, document teardown and breach response, and keep the Vultr deployment synthetic-only.

## Evidence inspected

- `docker/development-easy/docker-compose.yml`, `docker/development-easy-light/docker-compose.yml`, and `deploy/vultr/docker-compose.yml`
- Standard REST and FHIR route definitions
- REST authorization, FHIR patient-context, OAuth/SMART, and health-check code
- OpenEMR API documentation
- Local MariaDB counts, indexes, audit-log counts, and null/duplicate checks
- Vultr health, login, API authorization, discovery, exposed-path, header, and certificate checks
- `docs/agentforge/fixtures/clinical-cases.json` and its README
