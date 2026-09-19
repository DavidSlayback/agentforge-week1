# AgentForge final interview defense

## Opening

AgentForge is a synthetic, read-only primary-care return-visit preparation
layer. It surfaces evidence and documented follow-through gaps; it does not
diagnose, recommend, write to the chart, or make clinical decisions.

## Architecture answer

The request crosses a thin OpenEMR launcher, a signed server-verified synthetic
context, an allowlisted retrieval seam, evidence normalization, verification,
deterministic synthesis, and redacted observability. The provider is downstream
of authorization and verification; it cannot select patients, URLs, SQL, or
OpenEMR operations.

## Why synthetic forever?

The owner decision is to keep the product synthetic and fixture-backed while
building the controls expected of a real platform. That gives reproducible
identity, isolation, partial-retrieval, provider-failure, retention, recovery,
and load evidence without PHI. It does not prove clinical safety, OpenEMR
authorization parity, vendor suitability, or compliance.

## Why the signed context?

The browser may display a patient selector for the synthetic evaluator, but the
service authorizes only a matching server-verified context. Expired, mismatched,
missing, or non-read contexts fail closed before retrieval. The demo issuer is
explicitly synthetic; it is not being presented as an OpenEMR identity provider.

## Why a deterministic fallback?

The optional provider lane retries twice and then returns to a deterministic
provider. That keeps the safety and evaluation contract reproducible during
provider outage. No hosted vendor is selected, and no PHI may enter that path.

## What do the measurements prove?

The signed synthetic local run completed 100/100 requests at concurrency 10
and 500/500 at concurrency 50. p50/p95/p99 were 23.87/31.84/32.43 ms and
159.96/178.33/186.83 ms respectively. These are local synthetic measurements,
not production capacity, Railway SLOs, or cost guarantees.

The historical Vultr readback also completed 100/100 requests at concurrency 10
and 500/500 at concurrency 50 with zero errors. The measured p50/p95/p99 were
42.11/99.73/121.02 ms and 123.93/625.76/1725.39 ms respectively. These are
bounded synthetic observations on the current 2-vCPU Vultr shape, not a
production capacity guarantee or an attribution of all account spend.

## What remains deliberately limited?

The deployment does not use live OpenEMR, PHI, clinical write-back, a hosted
model, external alert delivery, off-host backup, cross-region durability, or a
secret manager. Those are explicit non-claims and separate future decisions.

## Feedback answer

The early submission failed at delivery: the URL was not reliably browser-
accessible and the agent capability existed behind an API instead of as a
multi-turn surface. The correction was to close the external browser loop,
make follow-up visible, surface safety/operations evidence, and test the
deployed path rather than infer it from code.
