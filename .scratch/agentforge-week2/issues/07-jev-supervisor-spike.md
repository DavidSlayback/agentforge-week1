# 07: Jev versus standard supervisor spike

**Type:** AFK; promotion decision is HITL

**What to build:** A bounded paired comparison of the deterministic supervisor
against a Jev-backed typed-judgment supervisor using the same routing and
ambiguity cases, without making Jev a dependency of the release path.

**Blocked by:**

- 05: Deterministic supervisor workflow
- 06: Redacted observability and evaluation scaffold

**Status:** accepted-with-residual

- [x] The comparison harness runs on the same labeled 20-case corpus for both supervisors; the live Jev lane is explicitly `unavailable` when no process credential is configured.
- [x] Results measure routing correctness, clarification/abstention, unsafe handoffs, latency, cost, traceability, and reproducibility.
- [x] Jev failures are distinguishable as `jev_unavailable`, `adapter_failure`, `service_failure`, or `workflow_failure`; prompt-specific failures remain a future adapter refinement.
- [x] The deterministic supervisor remains runnable when Jev is unavailable.
- [x] The spike produces a recommendation artifact; promotion requires no safety/traceability regression, at least baseline quality, and lower cost.

**Evidence:** `agentforge/src/jevSpike.js`, `agentforge/test/jev-supervisor.test.js`, and `docs/agentforge/W2_JEV_SPIKE.md`.

**Residual:** The live 20-case Jev comparison is not claimed complete in this run because `JEV_API_KEY` is not present in the process environment. The supplied credential was not persisted or echoed. The deterministic comparator has zero measured provider cost, so a lower-cost Jev promotion cannot be established until a fair costed standard-supervisor comparator is supplied.
