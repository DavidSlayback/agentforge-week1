# AgentForge load and cost evidence

The load harness is `scripts/agentforge-load.mjs`. It uses the public HTTP
contract, an optional signed synthetic context, and no external dependencies.
It records p50/p95/p99 latency, throughput, error rate, workload concurrency,
and the service metrics snapshot after the run.

## Reproducible commands

Start the service with an isolated redacted trace file, then run:

```text
node scripts/agentforge-load.mjs --base-url http://127.0.0.1:8787 --concurrency 10 --requests 100 --out .scratch/overnight/evidence/load-10.json
node scripts/agentforge-load.mjs --base-url http://127.0.0.1:8787 --concurrency 50 --requests 500 --out .scratch/overnight/evidence/load-50.json
```

The harness fails if any request is non-2xx or cannot be completed. The report
is a measured synthetic deployment result, not a production capacity claim.

## Cost model boundary

The deterministic provider has zero provider spend. A hosted provider remains
deferred, so no vendor price is treated as an observed cost. Any future cost
projection must state provider price, token assumptions, request mix, Railway
resource tier, storage/egress assumptions, and the architecture changes at
100/1K/10K/100K users.
