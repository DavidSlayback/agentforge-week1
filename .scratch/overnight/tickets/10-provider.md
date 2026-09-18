# AF-10 — Add the governed provider-ready model lane

**GitLab:** [#11](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/11)  
**Type:** HITL  
**Blocked by:** AF-08, AF-09 — approved processing boundary and retrieval contract  
**Wave:** 6  
**Lane:** model-lane / serial-required
**Critical path:** Yes — provider behavior is required for observability, cost, and final claims.  
**Parallelization:** Serial with retrieval-contract integration and operational telemetry; provider/data-processing decisions are HITL.

## What it delivers

A provider-ready path whose output remains subordinate to authorization, evidence qualification, strict contracts, and verification-before-display.

## Acceptance criteria

- [ ] Provider, deployment mode, data boundary, BAA/terms, and approved environments are explicit.
- [ ] Timeout, retry, rate limit, unavailable provider, malformed output, unsafe content, and fallback behavior fail safely.
- [ ] Evidence grounding, attribution, domain constraints, and limitations hold after substitution.
- [ ] Redacted latency, tokens, cost, retries, verification, and display outcomes retain correlation IDs.
- [ ] Deterministic regression remains passing or approved differences are explained.

## Verification

- Provider failure/eval suite, redacted trace inspection, and deterministic-vs-provider comparison.

## Independent verifier

- **Profile:** Provider/data-boundary verifier who can inspect configuration and run failure cases without changing the approved policy.
- **Commands:** `npm --prefix agentforge test`; `node --test agentforge/test/provider.test.js` — provider timeout, retry, rate-limit, unavailable, malformed, unsafe-content, fallback, attribution, and verification cases pass; `npm --prefix evals test` — deterministic regression remains green.
- **Evidence required:** Approved provider decision, data-processing/BAA record, failure matrix, redacted token/cost/latency traces, and comparison report. The verifier must reject any provider path that can display unverified output or process unapproved PHI.
- **Verifier output:** Write `.scratch/overnight/evidence/AF-10.md` with per-criterion status, implementation/runtime/external evidence types, scope/review status, and limitations; missing provider authorization is `INCONCLUSIVE`.

## Change surface

- Provider adapter/config, failure policy, verification/evals, cost telemetry.
- Conflict risk: high; changes runtime and evidence semantics.

## Out of scope

- Unapproved hosted-model use with real PHI.

## Completion evidence

Approved provider decision, eval report, failure matrix, and trace samples.
