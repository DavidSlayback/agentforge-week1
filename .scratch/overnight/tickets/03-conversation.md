# AF-03 — Expose a synthetic briefing-to-follow-up conversation

**GitLab:** [#4](https://labs.gauntletai.com/gauntletai/gauntlet/agentforge-week1/-/work_items/4)  
**Type:** AFK  
**Blocked by:** AF-01 — approved use-case and contract boundary  
**Wave:** 1  
**Lane:** product-ui
**Critical path:** Yes — feeds AF-04 and the early gate.  
**Parallelization:** Can work beside AF-02 and AF-05; integrate after canonical contracts and before safety-state work.

## What it delivers

A deployed-shaped conversation panel that turns the briefing into the first assistant turn and supports evidence-grounded follow-ups through the existing service endpoint.

## Acceptance criteria

- [ ] Three accepted follow-up intents work: documented changes, plan follow-through, and conflicting records.
- [ ] Transcript, patient context, correlation/conversation ID, pending/error, reset, and evidence states render.
- [ ] Follow-ups call the existing service contract; no browser-only answers.
- [ ] One complete exchange is covered by browser or service integration tests.

## Verification

- Project test command for AgentForge plus deployed-shaped integration smoke — briefing and follow-up share correlation and patient scope.

## Independent verifier

- **Profile:** Service/UI contract verifier who did not author the conversation implementation.
- **Commands:** `npm --prefix agentforge test` and `npm --prefix evals test` — existing service/eval tests pass; the ticket must add a deterministic conversation-flow test that fails when the composer, second turn, correlation ID, or patient binding is absent.
- **Evidence required:** Test output plus a black-box transcript showing initial briefing, one accepted follow-up, preserved correlation ID, and reset behavior. A static HTML inspection alone is insufficient; the external gate remains the browser proof.
- **Verifier output:** Write `.scratch/overnight/evidence/AF-03.md` from the exact candidate base with per-criterion results, test/runtime evidence, scope/review status, and limitations; no implementer summary substitutes for the transcript.

## Change surface

- AgentForge panel, browser state, conversation endpoint integration, UI tests.
- Conflict risk: medium; AF-04 and AF-06 consume the same UI shell.

## Out of scope

- New clinical recommendations, writes, diagnoses, arbitrary tools, SQL, or model-controlled URLs.

## Completion evidence

Test result and browser capture of one briefing plus one follow-up.
