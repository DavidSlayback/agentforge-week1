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

## Latest measured split-lane resource sample

Candidate `56d1a35` was sampled during bounded public runs with Qwen synthesis and
Gemini Flash-Lite conversation. At concurrency 10, 10/10 requests completed with
0.229 requests/second, p50 29.97 seconds, and p95 43.68 seconds. At concurrency
50, 46/50 completed before the 45-second client deadline (8% client timeout rate),
with 1.111 requests/second, p50 30.19 seconds, and p95 45.00 seconds. The AgentForge
container peaked at 29.06% CPU and 52.01 MiB resident memory (about 1.36% of the
3.818 GiB limit). These are container observations on the selected Vultr host, not
host-wide saturation or production SLO evidence. The 50-concurrency result is the
named tail-latency limitation, not a claim of production capacity.

The final deployed candidate is `88420c1`. No new 10/50 load run was performed
after that deployment, so this sample remains explicitly tied to `56d1a35`.

## Interpretation

This load result is a synthesis result, not an interactive-conversation failure.
Ahead-of-visit synthesis may run asynchronously before the clinician opens the+visit. The interactive lane is separately configured through OpenRouter and is+used for short patient-scoped follow-ups. Therefore the Qwen tail is an accepted+preparation limitation for this demo, while follow-up latency remains a separate+runtime concern and must not be inferred from the synthesis load sample.
