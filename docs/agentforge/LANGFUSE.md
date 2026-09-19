# Langfuse integration boundary

AgentForge now has a narrow, dependency-free integration with the supported
Langfuse v4 OpenTelemetry ingestion endpoint. `LangfuseTraceSink` always writes
the redacted local record first, then performs a best-effort asynchronous export
when all three server-only settings are present:

```dotenv
LANGFUSE_BASE_URL=http://langfuse-web:3000
LANGFUSE_PUBLIC_KEY=<server-only-project-public-key>
LANGFUSE_SECRET_KEY=<server-only-project-secret-key>
LANGFUSE_TIMEOUT_MS=3000
```

The exporter sends one OTLP span per completed request. Its attribute payload is
an explicit operational allowlist: operation, interaction type, deadlines,
stage timing, retrieval status, retry totals, provider/model metadata,
coverage status, verification outcomes, display status, cache status, and
request status. It does not send prompts, generated text, chart fields,
patient/clinician identifiers, source references, credentials, or raw request
objects. The local sink remains the recovery and test oracle if Langfuse is
disabled or unavailable. Export concurrency is bounded by
`LANGFUSE_MAX_PENDING_EXPORTS` (default 16); excess telemetry is dropped with a
stable operational error code rather than allowed to build unbounded request
pressure. Caller-supplied conversation IDs are HMAC-derived before they enter
responses, local traces, or exported spans; already-issued opaque IDs remain
stable across stale refreshes.

This is an implementation and deployment-preparation claim, not a deployment
claim. The repository now contains a separate pinned Compose artifact at
`deploy/vultr/langfuse/` for Langfuse v4.38.0, with loopback-only UI/object
storage bindings and a private Docker network shared with AgentForge. Its
`.env.example` contains placeholders only. The artifact has passed local
`docker compose config` validation; it has not been activated on Vultr.

External evidence is still required for server identity and access, VM
capacity, server-only credential provisioning, retention/backup custody, UI
readback, and an end-to-end synthetic trace. The current owner-controlled
Vultr VM is below Langfuse's published Docker Compose guidance of 4 cores and
16 GiB RAM, so the artifact is not activated there. Until the capacity choice
and remaining evidence exist, `/observability` and local tests must not be
described as a live Langfuse dashboard.

The current demo choice is AgentForge-lite: the local redacted file sink,
metrics, alerts, and `/observability` page remain the operational surface. The
Langfuse exporter is retained only as an optional OTLP adapter for a later
owner-approved hosted project or resized host.

No provider activation, PHI, chart write, or production authorization is
required by this integration. The synthetic-only, read-only,
clinician-reviewed boundary remains unchanged.
