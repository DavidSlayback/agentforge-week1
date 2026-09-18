# AgentForge AFK checkpoint

**State:** `NEEDS_HUMAN` at AF-02 after AF-04; no further ticket is eligible without the deployment boundary.

## Completed

- Queue migration approved by David.
- AF-01 requirements/evidence gate recorded as approved for implementation using `docs/agentforge/REQUIREMENTS.md` as the working inventory; the unavailable source PDF remains a final-evidence limitation.
- Existing repository tests confirmed: AgentForge 5/5, evals 10/10, observability 5/5.

## Active plan

1. Resolve AF-02's canonical hostname, trusted TLS, redirect, and external route verification.
2. Refresh the queue and dispatch only the next unblocked ticket after that evidence is approved.

## Recovery action

Read `QUEUE.md`, `STACK.md`, this file, the ticket evidence files, and `DECISIONS.md`; inspect `git status --short --branch`; resume only after the HITL blocker is resolved.
