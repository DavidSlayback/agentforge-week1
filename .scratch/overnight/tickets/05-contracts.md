# AF-05 — Harden canonical contracts and publish a runnable API collection

**GitLab:** [#6](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/6)  
**Type:** AFK  
**Blocked by:** AF-01 — complete brief defines release-critical contracts  
**Wave:** 1  
**Lane:** contracts
**Critical path:** Yes — feeds AF-06 and AF-07.  
**Parallelization:** Can work beside AF-02 and AF-03, but schema/contract integration is serial; consumers must use this source of truth.

## What it delivers

Strict canonical schemas and a runnable collection for briefing, follow-up, scope, evidence, qualification, failures, health, readiness, metrics, traces, and observability.

## Acceptance criteria

- [ ] Requests/responses validate against one source of truth and fail closed on malformed data.
- [ ] Collection runs against a configured base URL without source inspection.
- [ ] Examples cover success, partial, denied, cross-patient, and dependency failure paths.
- [ ] Status codes, correlation IDs, evidence, qualification, and limitations are documented.

## Verification

- Contract test command and collection runner — all examples pass against the deployed-shaped service.

## Independent verifier

- **Profile:** Contract verifier who runs the collection from a clean environment and inspects schema failure behavior.
- **Commands:** `npm --prefix agentforge test` and `npm --prefix evals test` — contract, service, and golden tests pass; the collection command documented by the ticket must execute success and failure examples without source inspection.
- **Evidence required:** Collection run transcript, schema/version inventory, expected status-code table, and a negative-input result. The verifier must reject a collection that only exercises happy-path 200 responses.
- **Verifier output:** Write `.scratch/overnight/evidence/AF-05.md` from a clean candidate state with per-criterion results, command output, implementation/runtime evidence types, scope/review status, and limitations.

## Change surface

- Schema/contract definitions, API examples, contract tests, CI command.
- Conflict risk: high; other work must consume these contracts rather than fork them.

## Out of scope

- Provider-specific or live OpenEMR schemas.

## Completion evidence

Collection run report, schema validation results, and documented command.
