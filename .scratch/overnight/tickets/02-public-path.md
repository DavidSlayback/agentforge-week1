# AF-02 — Restore one canonical public HTTPS evaluator path

**GitLab:** [#3](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/3)  
**Type:** HITL  
**Blocked by:** AF-01 — URL and evidence contract  
**Wave:** 1  
**Lane:** deployment / serial-required
**Critical path:** Yes — one of the two checkpoint branches feeding AF-07.  
**Parallelization:** Can proceed beside AF-03 and AF-05 after AF-01, but deployment/configuration integration is serial.

## What it delivers

One stable, trusted HTTPS URL with redirect and same-origin routing for the UI, API, health, readiness, metrics, traces, and observability surfaces.

## Acceptance criteria

- [ ] Fresh external browser reaches the UI without certificate bypass.
- [ ] HTTP redirects to HTTPS and the canonical host/path is documented.
- [ ] All documented routes work under the base path; internal service ports are not the browser contract.
- [ ] External DNS/TLS/redirect/base-path smoke evidence is captured.

## Verification

- External browser and non-host-local HTTP client — trusted TLS, redirect, UI 200, and operational route matrix pass.

## Independent verifier

- **Profile:** External deployment verifier with no reliance on the implementer's host-local browser state.
- **Commands:** `$env:AGENTFORGE_CANONICAL_URL='https://<host>/agentforge'; curl.exe --fail-with-body --max-time 20 "$env:AGENTFORGE_CANONICAL_URL/"` — UI returns 200 without certificate bypass; `curl.exe -I --max-time 20 'http://<host>/agentforge/'` — redirects to HTTPS; repeat for `/health`, `/ready`, `/v1/metrics`, `/v1/traces`, and `/observability` — expected documented statuses.
- **Evidence required:** Raw command output, certificate-chain result, fresh-browser capture, and route matrix. `<host>` must be replaced by the approved canonical host; the verifier must not accept the current IP/self-signed endpoint.
- **Verifier output:** Write `.scratch/overnight/evidence/AF-02.md` from a clean verification state with per-criterion PASS/FAIL/INCONCLUSIVE, command results, runtime/external evidence types, scope/review status, and limitations.

## Change surface

- Reverse proxy, DNS, certificate, deployment configuration, setup/submission docs.
- Conflict risk: high with no other deployment work; integrate serially.

## Out of scope

- Real PHI, OpenEMR auth, or hosted-model rollout.

## Completion evidence

Canonical URL, certificate-chain result, route matrix, and fresh-browser recording.
