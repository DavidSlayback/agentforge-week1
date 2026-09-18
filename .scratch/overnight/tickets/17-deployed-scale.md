# AF-17 — Produce deployed 10/50 concurrency and infrastructure evidence

**Type:** HITL
**Blocked by:** AF-12, AF-13, AF-16 — harness, package, and claim language must be stable.
**Wave:** 13
**Lane:** deployed-performance / external
**Critical path:** Yes.

## What it delivers

Current-commit deployed load reports at 10 and 50 concurrency with CPU,
memory, storage/network, latency, throughput, error rate, queue depth, and
timestamps.

## Acceptance criteria

- [ ] The exact current candidate commit is deployed with strict synthetic mode.
- [ ] 10- and 50-concurrency reports complete with p50/p95/p99 and zero unexplained errors.
- [ ] CPU, memory, storage/network, resource limits, deployment version, and timestamps are recorded.
- [ ] Dashboard metrics cross-check the raw harness reports; bounded-window semantics are stated.
- [ ] No local result is relabeled as deployed capacity.

## Verification

Run the checked-in load harness against the final public URL and inspect the
deployment provider readback. This cannot close from repository tests alone.
