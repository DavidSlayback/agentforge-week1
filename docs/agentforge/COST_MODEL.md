# AgentForge scale and cost model

**Status:** evidence-bounded planning model for the synthetic, read-only
platform. This is not a production capacity or provider quote.

## Observed current candidate

- Deployment: one Vultr Cloud Compute instance in Chicago running the pinned
  OpenEMR, MariaDB, Caddy, and AgentForge Compose stack.
- Instance shape at console readback: 2 vCPUs, 4,096 MB RAM, 80 GB SSD.
- Current instance charge at the console readback: **$1.31**.
- Account billing readback: **$1.36** charged this month and **$28.64** credit
  remaining. The account figure is not attributed solely to AgentForge.
- Provider spend in the current deterministic mode: **$0**.
- Deployed synthetic load: 100/100 requests at concurrency 10 and 500/500 at
  concurrency 50, with zero errors. These are bounded observations, not a
  user-capacity guarantee.

Vultr bills server products hourly, so the observed partial-period charge must
not be treated as a monthly rate. The current host's actual plan rate, storage,
backup, and egress line items must be read from the provider account before a
budget is approved.

## Workload assumptions

These are explicit planning assumptions, not observed clinical usage:

- One monthly active clinician completes four preparation sessions per month.
- One session contains one briefing and three follow-ups: four service
  interactions per session, or **16 interactions per monthly active clinician**.
- Synthetic mode uses the deterministic provider, so provider cost is zero.
- A future hosted-provider cost is not modeled until a vendor, token budget,
  data-processing terms, and retention decision are approved.

| Monthly active clinicians | Planned interactions/month | Primary limiting resource | Required architecture |
| ---: | ---: | --- | --- |
| 100 | 1,600 | Single-host failure domain and local database | Keep one app node for the synthetic demo; add scheduled backup/readback and explicit resource alerts. |
| 1,000 | 16,000 | App concurrency and database contention | Split AgentForge replicas from OpenEMR/MariaDB; add a managed database or dedicated DB node, bounded queue, cache, and centralized redacted telemetry. |
| 10,000 | 160,000 | Retrieval fan-out, queueing, and telemetry volume | Add autoscaling workers, managed DB read replicas, durable queue/cache, object storage for redacted evidence, rate limits, and provider budget controls. |
| 100,000 | 1,600,000 | Regional availability, tenant isolation, and upstream capacity | Use multi-zone app/worker pools, managed HA database, partitioned retrieval, regional routing, durable event/trace pipeline, disaster recovery, and formal SLO/error-budget controls. |

## Cost equations

Let `H` be the verified monthly price of the current 2-vCPU host, `V` the
durable-volume/backup cost, `D` managed-database cost, `C` cache cost, `Q`
queue cost, `T` telemetry/object-storage cost, `E` egress, and `P` approved
provider spend. The planning envelopes are:

| Tier | Synthetic monthly envelope | Future hosted-provider addition |
| --- | --- | --- |
| 100 | `H + V + T` | `P`, currently `$0` in deterministic mode |
| 1,000 | `2H + D + C + Q + T + E` | `interactions × (input_tokens × input_rate + output_tokens × output_rate)` |
| 10,000 | `5–10H + D + C + Q + T + E` | Same formula plus retry/fallback allowance |
| 100,000 | `N×H + HA-D + HA-C + HA-Q + T + E` | Same formula plus regional/provider redundancy allowance |

`N` is an autoscaled node count to be established by a new load test; it is
intentionally not guessed from the current 50-concurrency run. The cost model
therefore distinguishes observed account spend, synthetic provider spend, and
hypothetical future architecture rather than converting an un-attributed bill
into a false monthly forecast.

## Decision gates

Before any real-data or hosted-provider trial, the owner must approve the
provider, token/request budget, data-processing terms, retention policy,
failure behavior, and the corresponding `P` line. Before claiming a scale
tier, run the tier's workload against the proposed architecture and capture
CPU, memory, database saturation, queue depth, p95/p99 latency, error rate,
egress, and telemetry cost.

Source notes: current values are from `.scratch/overnight/evidence/AF-17.md`
and `AF-18.md`; provider billing is hourly per the [Vultr billing
documentation](https://docs.vultr.com/support/platform/billing/how-am-i-billed-for-my-servers).
