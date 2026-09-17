# AgentForge observability

`index.js` provides redacted local traces, bounded in-memory storage, basic
request metrics, and separate health/readiness dependency checks. Trace payloads
exclude chart text and direct patient identifiers by default.
