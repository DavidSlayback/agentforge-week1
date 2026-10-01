# AgentForge observability

`index.js` provides redacted local traces, bounded in-memory and file-backed
storage, retention/deletion controls, basic request metrics, and separate
health/readiness dependency checks. Trace payloads exclude chart text and
direct patient identifiers by default.

`FileTraceSink` stores only redacted traces, bounds the record count, expires
records after `retentionMs`, and asynchronously writes with a temporary file
and rename. `record()` updates the in-memory view immediately; `flush()` waits
for queued writes when a durability boundary is required. It supports explicit
`deleteAll()` cleanup. It is a local synthetic-checkpoint
primitive, not a compliance claim or a replacement for a reviewed production
telemetry backend. Async `backup(path)` and `restore(path)` provide a checked local
recovery seam; deployment storage, off-host backup, rollback orchestration, and
restore drills remain separate operational evidence.

When `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, and `LANGFUSE_SECRET_KEY` are
present, `LangfuseTraceSink` asynchronously exports the already-redacted trace
as one OTLP span to Langfuse v4. The local file sink remains authoritative for
tests and recovery; Langfuse ingestion is not part of request correctness.
When it is configured, the server's `/ready` probes its public health route
(`LangfuseOtelExporter#checkReachable`). Export concurrency is bounded by `LANGFUSE_MAX_PENDING_EXPORTS` so
an outage cannot create unbounded fetch work. Credentials are read only from
the environment and are never put in trace attributes, logs, or repository
files.

## Redaction

`redactPayload` replaces the value of any key whose name matches a sensitive
pattern (patient, clinician, chart, prompt, text, value, quote, content and
similar) with `[REDACTED]`. Since the W3 hardening (lane H2) it also checks
values under keys that must hold codes: `reason`, `reasons`, `errorCode`,
`error_code`, `issues`, `correlationId` and `correlation_id`. A string there is
kept only when it is code-shaped (`^[a-z0-9_.:-]{1,80}$`, case-insensitive, so
upper-case error codes such as `TRACE_STORE_CORRUPT` pass) and contains no
date; anything else becomes `[REDACTED]`. Residual: a single word with no
space, digit run or date (a surname alone) is code-shaped and still passes, so
callers must still put only codes in those fields. Tested on real briefing and
scan traces in `agentforge/test/w3h-service-security.test.js`.

## Refusals and the alert metrics

`InMemoryTraceSink#countRefusal(reason)` counts a request refused before
authorization succeeded, by reason code, without recording a trace. The
server calls it for every 401, 403 and 429 answer, and the service for a
briefing or follow-up that fails authorization or conversation scope.
`snapshot()` reports `refusals: {total, byReason}` (since process start, not
windowed, not persisted; a non-code reason counts as `other`, at most 50
reasons). Refusals are not in `requests`, `errorRate` or the latency
percentiles, so a flood of refused requests can neither dilute nor trip the
error-rate and p95 alerts; watch `refusals.total` for one.

`createReadinessChecker` passes a dependency's `mode` through (for example
`model: {status: ready, mode: deterministic}`).
