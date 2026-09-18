# AF-12 — Produce deployed load, infrastructure, and cost evidence

**GitLab:** [#13](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/13)  
**Type:** HITL  
**Blocked by:** AF-09, AF-10, AF-11 — actual governed dependencies and telemetry  
**Wave:** 8  
**Lane:** performance-cost / serial-required
**Critical path:** Yes — final release claims depend on these measurements.  
**Parallelization:** Serial; workload, metric semantics, provider cost, and infrastructure configuration must be frozen for comparison.

## What it delivers

Reproducible deployed load results at 10 and 50 concurrent users, infrastructure baselines, and cost projections at 100/1K/10K/100K users with architecture implications.

## Acceptance criteria

- [ ] Both load levels report p50/p95/p99, error rate, throughput, queue depth, retries, and dependency failures.
- [ ] CPU, memory, network/storage, limits, saturation, and timestamps are recorded.
- [ ] Actual development spend and four scale projections state assumptions and architectural changes.
- [ ] Bottlenecks, capacity limits, and remediation/rollback decisions are evidence-linked.

## Verification

- Re-run load command in the approved environment and review generated report against dashboard data.

## Independent verifier

- **Profile:** Performance/cost reviewer who did not run the original load test and can inspect raw run metadata.
- **Commands:** The ticket must provide a checked-in reproducible load command; verifier reruns it at 10 and 50 concurrency and compares p50/p95/p99/error/throughput/queue/retry fields to the report. `node --test observability/test/observability.test.js` — metric field semantics remain valid.
- **Evidence required:** Raw load output, environment/configuration snapshot, resource samples, dashboard cross-check, spend source, four projections, assumptions, saturation points, and approved architecture-change decisions. Unsupported scale claims fail verification.
- **Verifier output:** Write `.scratch/overnight/evidence/AF-12.md` from a clean candidate/environment state with per-criterion results, runtime/external evidence types, scope/review status, and limitations.

## Change surface

- Load harness/config, infrastructure capture, cost model, performance report.
- Conflict risk: medium; consumes AF-11 metrics and must not redefine them.

## Out of scope

- Claiming production scale without the measured workload and environment.

## Completion evidence

Timestamped load reports, infrastructure baseline, cost model, and reviewed trade-off record.
