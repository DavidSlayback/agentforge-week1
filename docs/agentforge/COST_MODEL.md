# AgentForge scale and cost model

**Status:** evidence-bounded planning model for the synthetic, read-only
platform. This is not a production capacity or provider quote.

**Scope:** Week 1 only, the read-only briefing (one short synthesis call per
briefing, no OCR, no document pipeline), with infrastructure ranges from the
2026-09 Vultr readback. It is superseded for Week 2 by the root
[`W2_COST_LATENCY.md`](../../W2_COST_LATENCY.md), which prices the scan path
(OCR, retrieval, answer model, critic) from measured traces. That document is
current; its ~$85K/month at 100,000 clinicians is not comparable with the
$1.2K–$3.5K infrastructure-only range below.

## Observed historical candidate

- Deployment evidence: one historical Vultr Cloud Compute instance in Chicago running the pinned
  OpenEMR, MariaDB, Caddy, and AgentForge Compose stack.
- Instance shape at console readback: 2 vCPUs, 4,096 MB RAM, 80 GB SSD.
- Historical instance charge at the console readback: **$1.31**.
- Account billing readback: **$1.36** charged this month and **$28.64** credit
  remaining. The account figure is not attributed solely to AgentForge.
- Provider spend in the historical deterministic-only run: **$0**. The active
  synthetic demo now calls Qwen and Gemini Flash-Lite; zero provider cost does
  not describe that configuration. Complete provider billing attribution is open.
- Historical deployed synthetic load: 100/100 requests at concurrency 10 and 500/500 at
  concurrency 50, with zero errors. These are bounded observations, not a
  user-capacity guarantee.

Vultr bills server products hourly, so the observed historical partial-period charge must
not be treated as a monthly rate. The historical host's actual plan rate, storage,
backup, and egress line items must be read from the provider account before a
budget is approved.

## Workload assumptions

These are explicit planning assumptions, not observed clinical usage:

- One monthly active clinician completes four preparation sessions per month.
- One session contains one briefing and three follow-ups: four service
  interactions per session, or **16 interactions per monthly active clinician**.
- Synthetic refers to patient data. Model output can be live or deterministic;
  provider cost is zero only for the deterministic test configuration.
- The active hosted-provider lanes are Qwen synthesis and Gemini Flash-Lite
  conversation. Add measured usage and account billing to the infrastructure
  envelope; the repository does not establish complete provider spend.

| Monthly active clinicians | Planned interactions/month | Primary limiting resource | Required architecture |
| ---: | ---: | --- | --- |
| 100 | 1,600 | Single-host failure domain and local database | Keep one app node for the synthetic demo; add scheduled backup/readback and explicit resource alerts. |
| 1,000 | 16,000 | App concurrency and database contention | Split AgentForge replicas from OpenEMR/MariaDB; add a managed database or dedicated DB node, bounded queue, cache, and centralized redacted telemetry. |
| 10,000 | 160,000 | Retrieval fan-out, queueing, and telemetry volume | Add autoscaling workers, managed DB read replicas, durable queue/cache, object storage for redacted evidence, rate limits, and provider budget controls. |
| 100,000 | 1,600,000 | Regional availability, tenant isolation, and upstream capacity | Use multi-zone app/worker pools, managed HA database, partitioned retrieval, regional routing, durable event/trace pipeline, disaster recovery, and formal SLO/error-budget controls. |

## Numeric planning envelope

The assignment asks for numeric planning outputs, so the following is an
illustrative infrastructure-only envelope, not a bill or provider quote. It
assumes `H=$24/month` for one 2-vCPU/4-GB shared host, `V+T=$10/month` for
storage/telemetry, and the minimum architecture in the table above. The actual
Vultr plan price is location- and plan-specific and must be read from the
account before approval; Vultr bills non-GPU servers hourly up to 672 hours per
month ([billing rules](https://docs.vultr.com/support/platform/billing/how-am-i-billed-for-my-servers)).

| Monthly active clinicians | Infrastructure-only planning range | Provider spend |
| ---: | ---: | --- |
| 100 | **$34–$60/month** | Qwen vendor billing not available in repository; add measured token spend when the account readback exists. |
| 1,000 | **$70–$150/month** | Same explicit token formula; no vendor quote fabricated. |
| 10,000 | **$170–$400/month** | Same formula plus retry/fallback allowance. |
| 100,000 | **$1,200–$3,500/month** | Same formula plus regional/provider redundancy allowance. |

These ranges are intentionally labeled planning assumptions. They are useful for
architecture comparison, but they do not close vendor billing attribution or
authorize a provider migration.

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

Source notes: the former AF-17/AF-18 raw evidence was retired with the
historical queue; see `archive/HISTORICAL_QUEUE_SUMMARY.md` for its interpretation.
Provider billing is hourly per the [Vultr billing
documentation](https://docs.vultr.com/support/platform/billing/how-am-i-billed-for-my-servers).
