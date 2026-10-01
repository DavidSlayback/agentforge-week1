# AgentForge load test

Status: **run on the W2 freeze SHA `bfbb1eb2`** (tag `w2-final`, 2026-09-27):
400/400 requests, 0 errors on the re-run. Earlier runs on `d5a0df7e` (tag
`w2-final-rc1`) and `ee036f38` (`w2-final-rc2`) are kept below as history.
Numbers in "Results" and the per-SHA sections; raw data in
`docs/agentforge/evidence/load/`. No load run exists yet for a W3 (post-freeze)
SHA.

The harness is `agentforge/scripts/load-test.mjs` (Node `fetch`, no new
dependency). It supersedes `scripts/agentforge-load.mjs`, which sent only
fresh briefings at one level and had no p99 per route; that script is kept
only because older docs cite it.

## Method

- **Levels:** 10 and 50 concurrent virtual users, run one after the other.
  Each user takes the next request from a shared plan until the plan is done.
- **Requests:** at least 200 per level (`--requests`, default 200; fewer is
  refused).
- **Target:** one base URL. For the freeze run it is the W2 service,
  `https://dtstest.64.177.10.182.nip.io/agentforge-w2`, which serves every
  route in the mix.
- **Mint access (W3 security fix, after the `bfbb1eb2` runs).** The script
  sends `AGENTFORGE_DEMO_ACCESS_KEY` from its own environment as
  `X-AgentForge-Demo-Key`. From one client, the target allows 15 mints per
  60 s, so a load run needs `AGENTFORGE_MINT_RATE_LIMIT` raised on the target
  for the run, then restored. Without that, the `demo-context` share reports
  429s (`deploy/vultr/README.md`).
- **Mix** (seeded shuffle, reproducible from `--seed`):

  | Route | Share | Request |
  |---|---|---|
  | `GET /health` | 20% | liveness |
  | `GET /ready` | 15% | dependency readiness (the model probe is cached for 30 s) |
  | `GET /v1/demo-context` | 25% | signed synthetic token, 8 fixture patients in rotation |
  | `POST /v1/briefings` | 40% | the UI's call: `patient_uuid`, `clinician_uuid`, `demo_token`, no `case_id`, so a prepared briefing is reused for 5 minutes |
  | `POST /v1/scan-supervisor` | `round(requests x --scan-share)`, capped | one synthetic sample, `fixture-patient-001` |

  Shares apply to the requests left after the scans. Scans default to
  `--scan-share 0.02` and `--max-scans 4`, so 4 per level; `--max-scans`
  cannot exceed 10. The sample (`--scan-sample lab-a`, the synthetic
  `filled-lab-a.pdf`, so OCR runs on the server) is uploaded once before the
  level and every scan reuses it.
- **Success:** health `ok`; ready `ready`; a token returned; a briefing
  whose disposition is not `blocked` or `deadline-exceeded`; a scan whose
  `final_state` is `READY` or `QUALIFIED`. Anything else, a non-2xx status,
  or the 60 s client timeout (`--timeout-ms`) is an error.
- **Output:** `docs/agentforge/evidence/load/<sha>-<level>.json`, where
  `<sha>` is the git SHA the target reports on `/health`. Each file holds
  p50/p95/p99 (nearest-rank), min/mean/max, error rate, throughput, a
  per-route breakdown (count, errors, statuses, error codes, latency), the
  config and seed, the service's `/v1/metrics` after the level, and every
  request's route, status, latency and error code. No response body, token
  or patient value is written.
- **Guards:** a non-local `--base-url` needs `--live`. The exit code is 1
  when any counted request failed (the reports are still written).

Percentile math is covered by `agentforge/test/load-test.test.js` (in the
pre-commit hook); changing the nearest-rank rounding fails it.

## Expected model cost

Only scans and fresh briefings call models; health, ready, token and
reused-briefing requests do not.

| Source | Calls per freeze run (both levels) | Cost |
|---|---|---|
| Scans (answer composer, reranker and critic on Qwen/OpenRouter, one Gemini embedding) | 8 (4 per level) | typical 8 x $0.00064 = **$0.005**; worst case (3 answer attempts) 8 x $0.00136 = **$0.011** |
| Fresh briefing synthesis (Qwen) | about one per patient per 5 minutes (8 patients), plus a few duplicates when concurrent first requests for a patient race the cache; bounded by the briefing count, expected under 25 | estimate under **$0.005** (assumes about 1.5K input and 150 output tokens per call at Qwen list price; not measured) |

Expected total: **under $0.02** per freeze run. Per-scan prices are from
`W2_COST_LATENCY.md` §1–2 (Singapore list price, plus $0.00006 for the E2
critic call). The 8 Gemini embedding calls count against the free-tier quota;
if it is exhausted, retrieval degrades to `sparse_only` and the scan still
counts as a success. The dry run spends nothing (deterministic provider).

## Freeze run (orchestrator)

Run from a checkout of the freeze SHA, on a machine that can reach the public
URL. Start the resource sampler on the VM first, then the load test, then
stop the sampler and attach its samples.

1. On the VM, sample every container every 2 seconds for the whole run (both
   levels), one JSON object per line with a UTC timestamp:

   ```bash
   SHA=<freeze sha, first 8 chars>
   while true; do
     docker stats --no-stream --format '{{json .}}' | sed "s/^/$(date -u +%Y-%m-%dT%H:%M:%SZ) /"
     sleep 2
   done > "/tmp/${SHA}-docker-stats.jsonl"
   ```

2. From the operator machine:

   ```bash
   node agentforge/scripts/load-test.mjs --base-url https://dtstest.64.177.10.182.nip.io/agentforge-w2 --live
   ```

   It prints one line per level and writes
   `docs/agentforge/evidence/load/<sha>-10.json` and `<sha>-50.json`.

3. Stop the sampler (Ctrl-C), copy `/tmp/<sha>-docker-stats.jsonl` next to
   the JSON as `docs/agentforge/evidence/load/<sha>-docker-stats.jsonl`, and
   attach it to both reports:

   ```bash
   node agentforge/scripts/load-test.mjs attach-resources --report docs/agentforge/evidence/load/<sha>-10.json --stats docs/agentforge/evidence/load/<sha>-docker-stats.jsonl
   node agentforge/scripts/load-test.mjs attach-resources --report docs/agentforge/evidence/load/<sha>-50.json --stats docs/agentforge/evidence/load/<sha>-docker-stats.jsonl
   ```

   `attach-resources` adds peak and mean CPU% and memory (MiB) per container
   and the first and last sample times. The samples cover both levels, so
   read the per-level peaks from the `.jsonl` timestamps against each
   report's `started_at`/`completed_at` when they matter. `docker stats`
   measures containers, not the host; host-wide saturation is not captured.

4. Fill in "Results" below from the JSON and commit the three files.

## Dry run (local)

```bash
node agentforge/scripts/load-test.mjs --dry-run
```

Spawns a server from this checkout (synthetic context, deterministic
provider, in-memory persistence, no model calls), runs both levels with the
same mix, and writes to the OS temp directory unless `--out-dir` is given.
The scan sample defaults to the `.scan.txt` fixture, which needs no OCR.
The committed dry run on `7a625da0`
(`docs/agentforge/evidence/load/dry-run/local-7a625da0-{10,50}.json`) shows
the report format; its latencies measure a local process with no model or
OCR work and say nothing about the deployed service.

## Results

From the final freeze run on `bfbb1eb2` (tag `w2-final`; details in "Final
freeze run" below).

| Level | Requests | Error rate | p50 | p95 | p99 | Throughput | Peak CPU / memory (agentforge-w2) | SHA |
|---|---|---|---|---|---|---|---|---|
| 10 | 200 | 0 % | 59 ms | 2.71 s | 11.39 s | 12.4 req/s | 38 % / 54 MiB of 512 MiB (both levels) | `bfbb1eb2` |
| 50 | 200 | 0 % | 86 ms | 3.15 s | 11.66 s | 10.1 req/s | same window | `bfbb1eb2` |

`scan-supervisor` alone (n = 4 per level, critic on): p50 11.4 s and 11.7 s,
max 13.4 s and 18.9 s
(`docs/agentforge/evidence/load/bfbb1eb2-{10,50}.json`, `summary.per_route`).
The first 50-user run on this SHA had 20 `/ready` 503s; see "Final freeze run".

## Historical sample (W1, `56d1a35`)

Before this harness, candidate `56d1a35` was sampled with the old script
(fresh Qwen synthesis on every request). At concurrency 10, 10/10 completed,
p50 29.97 s, p95 43.68 s. At concurrency 50, 46/50 completed before the 45 s
client deadline (8% timeouts), p50 30.19 s, p95 45.00 s. The container peaked
at 29.06% CPU and 52.01 MiB. That run had 10 and 50 requests, not 200, no
p99, and names a commit that is no longer deployed; it is kept only as
history.

## Cost model boundary

`docs/agentforge/COST_MODEL.md` and `W2_COST_LATENCY.md` hold the scale
projections. No provider cost in this file is an observed bill.

## First freeze run (2026-09-27, SHA `d5a0df7e`, now tag `w2-final-rc1`)

`node agentforge/scripts/load-test.mjs --base-url https://dtstest.64.177.10.182.nip.io/agentforge-w2 --live`, with `docker stats` sampled every 5 s on the VM.

| Level | Requests | Errors | p50 | p95 | p99 | Throughput |
|---|---|---|---|---|---|---|
| 10 users | 200/200 ok | 0 | 46 ms | 2.34 s | 9.58 s | 13.0 req/s |
| 50 users | 200/200 ok | 0 | 82 ms | 3.52 s | 11.75 s | 13.0 req/s |

The p95 and p99 come from the capped share of full scan requests (OCR, model, critic); the cheap routes stay under 100 ms. `agentforge-w2` peaked at 32 % CPU and 58 MiB of its 512 MiB limit. Both levels share one sampling window of 7 samples, because they ran back to back. Raw data: `docs/agentforge/evidence/load/d5a0df7e-{10,50}.json` and `d5a0df7e-docker-stats.jsonl`.

## Re-freeze run (2026-09-27, SHA `ee036f38`)

Same command and sampling as the `d5a0df7e` run.

| Level | Requests | Errors | p50 | p95 | p99 | Throughput |
|---|---|---|---|---|---|---|
| 10 users | 200/200 ok | 0 | 47 ms | 3.06 s | 11.93 s | 9.4 req/s |
| 50 users | 200/200 ok | 0 | 103 ms | 3.26 s | 14.54 s | 11.2 req/s |

scan-supervisor (n=4 per level): p50 11.9 s and 14.5 s, max 16.1 s and 16.9 s, within the 25 s scan deadline. `agentforge-w2` peaked at 44 % CPU and 64 MiB of its 512 MiB limit (20 samples covering both levels). Raw data: `docs/agentforge/evidence/load/ee036f38-{10,50}.json` and `ee036f38-docker-stats.jsonl`.

## Final freeze run (2026-09-27, SHA `bfbb1eb2`)

| Level | Requests | Errors | p50 | p95 | p99 | Throughput |
|---|---|---|---|---|---|---|
| 10 users | 200/200 ok | 0 | 59 ms | 2.71 s | 11.39 s | 12.4 req/s |
| 50 users | 200/200 ok | 0 | 86 ms | 3.15 s | 11.66 s | 10.1 req/s |

scan-supervisor (n=4 per level): p50 11.4 s and 11.7 s, max 13.4 s and 18.9 s, within the 25 s scan deadline. `agentforge-w2` peaked at 38 % CPU and 54 MiB of 512 MiB. The first run on this SHA had 20 `/ready` 503s out of 29 `/ready` requests at 50 users; every other route returned 0 errors (`evidence/load/bfbb1eb2-50-run1-ready-503s.json`). It did not reproduce in a 40-request parallel `/ready` burst or in this re-run. `/ready` does not log a failure reason, so the failing dependency is unknown.
