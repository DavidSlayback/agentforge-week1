# AF-06 — Make operations and evaluator evidence discoverable

**GitLab:** [#7](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/7)  
**Type:** AFK  
**Blocked by:** AF-02 — canonical deployed origin; AF-05 — canonical routes/schemas  
**Wave:** 2  
**Lane:** evaluator
**Critical path:** Yes — feeds AF-07.  
**Parallelization:** Can be developed beside AF-04 in separate UI seams; integrate serially because both touch evaluator-panel/UI routing.

## What it delivers

A live evaluator panel linking operational views and saved golden-evaluation evidence, with safe prompts and explicit proof limitations.

## Acceptance criteria

- [ ] Health, readiness, metrics, traces, and redacted observability are reachable from the product.
- [ ] Safe sample prompts and deterministic failure/partial probes are listed.
- [ ] Golden evidence includes dataset, pass/fail semantics, and synthetic limitation.
- [ ] Default telemetry remains redacted and correlation-continuous.
- [ ] Fresh-browser links pass under the canonical base path.

## Verification

- Fresh-browser link walk plus route smoke — every link loads and points to the intended deployed evidence.

## Independent verifier

- **Profile:** Evaluator-discoverability verifier using a fresh browser profile and route client.
- **Commands:** `npm --prefix evals test` — existing evaluation contract remains green; with `$env:AGENTFORGE_CANONICAL_URL` set, `curl.exe --fail-with-body "$env:AGENTFORGE_CANONICAL_URL/health"`, `/ready`, `/v1/metrics`, `/v1/traces`, and `/observability` — every linked surface returns its documented result.
- **Evidence required:** Fresh-profile link walk, evaluator-panel capture, and saved-eval link readback. The verifier must confirm that links do not expose internal ports, filesystem paths, raw fixture excerpts, or stale evidence.
- **Verifier output:** Write `.scratch/overnight/evidence/AF-06.md` from a clean candidate state with per-criterion results, runtime/external evidence types, scope/review status, and limitations.

## Change surface

- UI evaluator panel, route links, evidence artifacts, deployed base-path config.
- Conflict risk: medium with AF-03/04; integrate serially with UI changes.

## Out of scope

- New telemetry backend or production alerts.

## Completion evidence

Link-walk result and screenshot/video of the evaluator panel.
