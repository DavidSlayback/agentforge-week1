# AgentForge observability and response guidance

The checkpoint exposes `/agentforge/observability`, `/agentforge/v1/metrics`,
and `/agentforge/v1/traces`. The default trace payload is bounded and redacted.
It includes correlation ID, ordered stage timing, retrieval attempts, retries,
model token/cost fields when supplied, coverage, verification, and display
outcomes. Local runs default to a file-backed synthetic store under `/tmp`;
the deployed container overrides this with `/data/traces.json` on an attached
volume. The retained-trace observation is deployment-specific evidence and is
not a general durability guarantee for every hosting environment.

The file sink updates the in-memory trace view immediately and persists records
through an asynchronous, ordered write queue. The `/v1/traces` read path flushes
that queue before returning records. The current local implementation also has
an optional Langfuse v4 OTLP exporter.
When configured with server-only `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`,
and `LANGFUSE_SECRET_KEY` values, it sends an explicit operational allowlist as
one span per completed request. Prompts, responses, chart fields, patient and
clinician identifiers, source references, and credentials are excluded before
the HTTP request. The local file sink remains durable and authoritative when
Langfuse is disabled or unavailable. This proves the exporter contract only;
it does not prove that a Langfuse instance is deployed or that its dashboard
has been read back.

For the current synthetic demo, the local file sink, `/v1/metrics`,
`/v1/alerts`, `/v1/traces`, and `/observability` page are the chosen operational
surface. The metrics include the bounded exporter queue, dropped-export count,
last export result, and whether an external exporter is configured. No
self-hosted Langfuse services are required for this path.

## Initial alert definitions

These are operational rules for the final deployment. They are documented now
so the dashboard fields have an explicit response contract.

Blocked authorization, patient-scope, and invalid-request outcomes remain in
the trace stream as safety evidence but are not operational errors. The error
rate counts service `failure` and `deadline-exceeded` outcomes; this keeps
negative safety probes from generating a false service-failure alert.

`/v1/alerts` evaluates the p95, error-rate, and tool-failure rules over the
latest five minutes and returns `windowMs: 300000` so the active measurement
window is explicit. `/v1/metrics` remains a retained-history aggregate for
diagnosis and evidence; it is not the alert window.

1. **High p95 latency:** alert when briefing p95 exceeds the agreed baseline
   for five minutes. Inspect stage timing; first isolate retrieval/provider
   latency, then reduce concurrency or disable the live provider if needed.
2. **Error-rate spike:** alert when more than 5% of requests fail over a
   rolling five-minute window. Inspect verification and provider errors; keep
   the service read-only and roll back the newest deployment if failures are
   systemic.
3. **Retrieval failure rate:** alert when failed/timeout retrieval groups exceed
   2% of groups. Retrieval currently performs one bounded read per group;
   model retry exhaustion is recorded separately. Inspect the adapter and upstream
   health; qualify or withhold affected briefings rather than serving stale
   unverified claims.
4. **Verification/display anomaly:** alert on any displayed response without a
   passed verification outcome. Treat as a release-blocking safety incident;
   disable display and preserve the redacted trace for investigation.

Thresholds remain provisional until deployed 10/50-user measurements establish
 a baseline. No PHI should be added to alerts or default traces.
