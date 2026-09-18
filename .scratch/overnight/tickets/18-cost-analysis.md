# AF-18 — Complete actual spend and scale-cost analysis

**Type:** HITL
**Blocked by:** AF-17 — cost assumptions must use the final measured deployment shape.
**Wave:** 14
**Lane:** cost-architecture / owner-review
**Critical path:** Yes.

## What it delivers

An evidence-bounded actual-spend summary and projections for 100, 1K, 10K,
and 100K users, including the architecture changes required at each tier.

## Acceptance criteria

- [ ] Actual development/deployment spend is sourced from vendor billing readback or explicitly marked unavailable.
- [ ] User/request/token/storage/egress assumptions are explicit.
- [ ] Each scale projection names the limiting resource and the required architectural change.
- [ ] Deterministic provider zero-cost behavior is separated from any hypothetical hosted-provider price.
- [ ] No production-cost or capacity claim is made from local synthetic measurements.

## Verification

Owner reviews the model against Railway/Vultr readback, load reports, provider
mode, and the final architecture. Missing billing evidence is `INCONCLUSIVE`,
not zero spend.
