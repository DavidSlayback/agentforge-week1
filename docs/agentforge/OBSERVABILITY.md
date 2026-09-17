# AgentForge observability and response guidance

The checkpoint exposes `/agentforge/observability`, `/agentforge/v1/metrics`,
and `/agentforge/v1/traces`. The default trace payload is bounded and redacted.
It includes correlation ID, ordered stage timing, retrieval attempts, retries,
model token/cost fields when supplied, coverage, verification, and display
outcomes. The deployed checkpoint uses in-memory storage; restart loses traces.

## Initial alert definitions

These are operational rules for the final deployment. They are documented now
so the dashboard fields have an explicit response contract.

1. **High p95 latency:** alert when briefing p95 exceeds the agreed baseline
   for five minutes. Inspect stage timing; first isolate retrieval/provider
   latency, then reduce concurrency or disable the live provider if needed.
2. **Error-rate spike:** alert when more than 5% of requests fail over a
   rolling five-minute window. Inspect verification and provider errors; keep
   the service read-only and roll back the newest deployment if failures are
   systemic.
3. **Retrieval failure rate:** alert when failed/timeout retrieval groups exceed
   2% of groups or retry exhaustion appears. Inspect the adapter and upstream
   health; qualify or withhold affected briefings rather than serving stale
   unverified claims.
4. **Verification/display anomaly:** alert on any displayed response without a
   passed verification outcome. Treat as a release-blocking safety incident;
   disable display and preserve the redacted trace for investigation.

Thresholds remain provisional until deployed 10/50-user measurements establish
 a baseline. No PHI should be added to alerts or default traces.
