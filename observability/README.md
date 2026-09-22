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
tests and recovery; Langfuse ingestion is not part of request correctness or
readiness. Export concurrency is bounded by `LANGFUSE_MAX_PENDING_EXPORTS` so
an outage cannot create unbounded fetch work. Credentials are read only from
the environment and are never put in trace attributes, logs, or repository
files.
