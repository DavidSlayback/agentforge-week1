# 07: Jev versus standard supervisor spike

**Type:** AFK; promotion decision is HITL

**What to build:** A bounded paired comparison of the deterministic supervisor
against a Jev-backed typed-judgment supervisor using the same routing and
ambiguity cases, without making Jev a dependency of the release path.

**Blocked by:**

- 05: Deterministic supervisor workflow
- 06: Redacted observability and evaluation scaffold

**Status:** ready-for-agent

- [ ] The comparison runs on the same labeled 20–30 case corpus for both supervisors.
- [ ] Results measure routing correctness, clarification/abstention, unsafe handoffs, latency, cost, traceability, and reproducibility.
- [ ] Jev failures are distinguishable from prompt, adapter, service, and workflow failures.
- [ ] The deterministic supervisor remains runnable when Jev is unavailable.
- [ ] The spike produces a recommendation artifact; Jev is promoted only with no safety/traceability regression, at least baseline quality, and lower cost.
