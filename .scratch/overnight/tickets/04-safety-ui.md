# AF-04 — Surface qualification, authorization, and patient-scope boundaries

**GitLab:** [#5](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/5)  
**Type:** AFK  
**Blocked by:** AF-03 — attach safety states to the real conversation  
**Wave:** 2  
**Lane:** safety-ui
**Critical path:** Yes — feeds AF-07 directly.  
**Parallelization:** Work is serial with AF-03; may be developed beside AF-06 only if the UI shell is isolated, otherwise integrate AF-04 before AF-06.

## What it delivers

Visible complete, qualified, withheld, blocked, failure, authorization, and patient-isolation states using deterministic demo fixtures.

## Acceptance criteria

- [ ] Synthetic status and active patient identity are always visible.
- [ ] Partial retrieval names missing coverage and does not imply negative evidence.
- [ ] Missing/expired/denied authorization blocks without patient data.
- [ ] Cross-patient follow-up is rejected without leakage; switching isolates conversations.
- [ ] Complete, partial, malformed/failure, blocked, and cross-scope tests pass.

## Verification

- Service/browser safety suite — each state has expected status, UI state, and no unauthorized content.

## Independent verifier

- **Profile:** Safety-boundary verifier using fixture cases and negative assertions.
- **Commands:** `npm --prefix agentforge test` and `npm --prefix evals test` — complete, partial, denied, cross-patient, malformed/failure, and withheld assertions pass; the ticket must add deterministic UI-state assertions rather than relying only on screenshots.
- **Evidence required:** State matrix mapping input fixture/authorization to HTTP result, rendered state, withheld fields, and forbidden content. The verifier must confirm that no unauthorized patient content appears in response, UI, trace, or error text.
- **Verifier output:** Write `.scratch/overnight/evidence/AF-04.md` from a clean candidate state with per-criterion results, boundary/runtime evidence, scope/review status, and limitations; any leakage is FAIL, not an ambiguity.

## Change surface

- Qualification/authorization renderers, fixture probes, conversation tests.
- Conflict risk: medium with AF-03; integrate after the conversation seam is stable.

## Out of scope

- Live OpenEMR retrieval or real identity provider integration.

## Completion evidence

Automated state matrix and external-browser probe capture.
