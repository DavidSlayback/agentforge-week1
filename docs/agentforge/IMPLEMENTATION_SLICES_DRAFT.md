# AgentForge implementation slices — published plan

Derived from `PRD_SYNTHETIC_E2E_OBSERVABILITY.md` and published to GitLab
under program issue #17. Each slice remains independently verifiable and must
not expand the synthetic-only, read-only boundary.

## Proposed breakdown

### 1. Governance and runtime decision gate

- **Type:** HITL
- **Blocked by:** None
- **User stories:** 9, 10, 11, 12, 14
- **What it delivers:** owner-approved Langfuse self-hosting shape, OpenRouter model/budget policy, trace retention/redaction policy, readiness semantics, and no-PHI statement.
- **Evidence:** signed decision record; environment/config contract; data-flow and retention table; explicit activation and rollback conditions.

### 2. Contract, signed-context, and coverage hardening

- **Type:** AFK after slice 1
- **Blocked by:** 1
- **User stories:** 3, 4, 5, 6, 7, 13
- **What it delivers:** one executable contract; deployed signed-context enforcement; adapter results filtered by successful coverage; regression-proof patient isolation and read-only operations.
- **Evidence:** contract/API probes; missing/expired/mismatched context tests; failed-group leakage mutations; seven golden cases plus updated service tests.

### 3. OpenEMR trust-boundary design gate

- **Type:** HITL
- **Blocked by:** 1, 2
- **User stories:** 1, 5, 6, 7
- **What it delivers:** an owner-approved decision on the exact OpenEMR patient-context, ACL/session, route, identifier, and read-only adapter seam. This ticket freezes the trust boundary before implementation.
- **Evidence:** route/controller/module map; selected patient-context mechanism; read allowlist; identifier normalization; no-write proof; explicit synthetic-data and rollback boundary.

### 4. Synthetic end-to-end OpenEMR retrieval

- **Type:** AFK
- **Blocked by:** 3
- **User stories:** 1, 2, 3, 4, 5, 6, 7
- **What it delivers:** OpenEMR module patient context routed to a server-side, allowlisted synthetic retrieval adapter using the approved OpenEMR auth/context seams, without PID-to-fixture guessing as the claimed integration path.
- **Evidence:** clean browser flow from patient context to briefing; request/response contract readback; route/ACL/context mapping; cross-patient and non-read negative probes; no writes; golden/eval parity.

### 5. Self-hosted Langfuse redacted tracing

- **Type:** AFK after slice 1
- **Blocked by:** 1, 2
- **User stories:** 10, 11, 13
- **What it delivers:** local Langfuse stack and exporter from the existing redacted trace lifecycle, preserving correlation IDs and stage/provider/verification/display metadata while excluding chart/prompt/response content. The hosted target is the existing VM; no second hosting VM is planned.
- **Evidence:** local Langfuse UI trace; correlation continuity; redaction assertions; ingestion failure behavior; local sink fallback; repeatable startup/teardown instructions.

### 6. OpenAI-compatible provider bakeoff and governed fallback

- **Type:** HITL activation gate plus AFK implementation
- **Blocked by:** 1, 4, 5
- **User stories:** 8, 9, 10, 14
- **What it delivers:** one configured OpenAI-compatible provider at a time, with the current authorized Alibaba Model Studio/Qwen3.6 Flash synthetic lane and OpenRouter retained as a future comparison candidate. Compare against deterministic output using the same synthetic cases, then record exact endpoint/model/budget policy.
- **Evidence:** no-key/timeout/invalid-output/retry-exhaustion tests; synthetic provider smoke only after authorization; groundedness/latency/cost comparison; redacted Langfuse trace; `/ready` and fallback readback; budget guard.

### 7. Dashboard, windows, queue depth, and alerts

- **Type:** AFK after slice 4; HITL for thresholds/ownership
- **Blocked by:** 1, 5, 6
- **User stories:** 9, 10, 11, 12, 13
- **What it delivers:** deployed Langfuse dashboard and/or explicit application metrics view with real windows, queue-depth source, p50/p95/p99, retries, fallbacks, verification/display outcomes, and three actionable alerts.
- **Evidence:** generated synthetic traffic changes metrics; browser dashboard readback; alert threshold tests; response owner/runbook; no raw clinical content.

### 8. Integrated synthetic deployment verification

- **Type:** HITL
- **Blocked by:** 2, 4, 5, 6, 7
- **User stories:** 1, 9, 11, 13, 14
- **What it delivers:** one named deployment candidate with exact source/image identity, trusted TLS, signed synthetic OpenEMR flow, Langfuse dashboard, API/eval probes, and rollback/retention readback.
- **Evidence:** clean browser and API collection; `/health`/`/ready`; evaluator results; Langfuse trace/dashboard; candidate identity; timestamps; explicit limitations.

### 9. Deployed scale, cost, and final evidence package

- **Type:** HITL
- **Blocked by:** 8
- **User stories:** 12, 13, 14
- **What it delivers:** current-candidate 10/50 concurrency evidence, CPU/memory/latency/throughput baselines, OpenRouter/infrastructure cost model, and final claim/evidence index.
- **Evidence:** raw reports; resource readback; cost assumptions and billing source; 100/1K/10K/100K architecture changes; owner release and no-publish decisions.

## Dependency shape

```text
1 governance
└──> 2 contract/auth/coverage ──> 3 OpenEMR trust gate ──> 4 synthetic OpenEMR E2E
1 + 2 ──> 5 Langfuse tracing
4 + 5 ──> 6 provider bakeoff ──> 7 dashboard/alerts
4 + 6 + 7 ──> 8 deployment verification ──> 9 scale/cost/package
```

## GitLab publication map

| Slice | GitLab issue | Type |
|---|---:|---|
| Program | [#17](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/17) | Parent |
| 1 Governance/runtime gate | [#18](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/18) | HITL |
| 2 Contract/auth/coverage | [#19](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/19) | AFK |
| 3 OpenEMR trust gate | [#20](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/20) | HITL |
| 4 Synthetic OpenEMR E2E | [#21](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/21) | AFK |
| 5 Langfuse tracing | [#22](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/22) | AFK |
| 6 Provider bakeoff/fallback | [#23](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/23) | HITL + AFK |
| 7 Dashboard/alerts | [#24](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/24) | AFK + HITL |
| 8 Deployment verification | [#25](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/25) | HITL |
| 9 Scale/cost/evidence | [#26](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/26) | HITL |

## Stacked PR order

PRs begin only after the preceding decision gate is satisfied. The stack is
reviewed and tested bottom-up; each PR targets the immediately preceding stack
head. Merge, deployment, provider activation, and external publication remain
separate approvals.

1. `stack/01-contract-auth-coverage` — issue #19, after #18.
2. `stack/02-openemr-e2e` — issue #21, after #20 and PR 1.
3. `stack/03-langfuse-redacted-tracing` — issue #22, after PR 2 and the #18/#19 gates.
4. `stack/04-provider-bakeoff-fallback` — issue #23, after #20/#21/#22 and explicit provider gate.
5. `stack/05-dashboard-alerts` — issue #24, after #23.
6. `stack/06-deployment-verification` — issue #25, after #24 and all preceding stack heads.
7. `stack/07-scale-cost-evidence` — issue #26, after #25.

HITL issues #18 and #20 are gates rather than PRs. The provider decision in
#23 contains an activation gate; no API key belongs in GitLab, source, traces,
or chat.
