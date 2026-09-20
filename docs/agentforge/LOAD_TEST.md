# AgentForge load and cost evidence

The load harness is `scripts/agentforge-load.mjs`. It uses the public HTTP
contract, a required signed synthetic context, and no external dependencies.
It records p50/p95/p99 latency, throughput, error rate, workload concurrency,
and the service metrics snapshot after the run.

## Reproducible commands

Start the service with an isolated redacted trace file, then run:

```text
node scripts/agentforge-load.mjs --base-url http://127.0.0.1:8787 --concurrency 10 --requests 100 --out .scratch/agentforge-load-10.json
node scripts/agentforge-load.mjs --base-url http://127.0.0.1:8787 --concurrency 50 --requests 500 --out .scratch/agentforge-load-50.json
```

The harness fails if signed-context acquisition fails, any request is non-2xx,
or a successful response is not a complete briefing. The report is a measured
synthetic deployment result, not a production capacity claim. Each request has
a bounded 60-second client timeout by default; override it with
`--timeout-ms` when the provider contract requires a different budget.

The load-harness argument regression is covered by:

```text
node --test scripts/test/agentforge-load.test.mjs
```

For a strict candidate run, set `AGENTFORGE_SYNTHETIC_CONTEXT=true`, provide a
server-only `AGENTFORGE_DEMO_SECRET`, and use a seeded synthetic patient. The
load helper obtains the short-lived signed synthetic context before posting.
The deployment bundle defaults to the synthetic context setting and mounts a
durable trace volume at `/data`.

## Cost model boundary

The deterministic provider has zero provider spend; the current deployed
synthetic lane uses Qwen and its vendor billing is not available in this
repository. No provider cost is fabricated as an observed value. Any future
cost projection must state provider price, token assumptions, request mix,
Vultr resource tier, storage/egress assumptions, and the architecture changes
at 100/1K/10K/100K users.

The current scale/cost artifact is `docs/agentforge/COST_MODEL.md`. It records
the observed Vultr/account charges separately from the synthetic zero-provider
cost and gives the required architecture changes and cost equations for each
scale tier.
