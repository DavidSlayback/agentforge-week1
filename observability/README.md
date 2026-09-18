# AgentForge observability

`index.js` provides redacted local traces, bounded in-memory and file-backed
storage, retention/deletion controls, basic request metrics, and separate
health/readiness dependency checks. Trace payloads exclude chart text and
direct patient identifiers by default.

`FileTraceSink` stores only redacted traces, bounds the record count, expires
records after `retentionMs`, writes with a temporary file and rename, and
supports explicit `deleteAll()` cleanup. It is a local synthetic-checkpoint
primitive, not a compliance claim or a replacement for a reviewed production
telemetry backend.
