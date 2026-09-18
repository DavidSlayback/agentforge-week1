# AgentForge AFK checkpoint

**State:** `TESTING` AF-03 on `afk/AF-03-conversation`; `NEEDS_HUMAN` remains at AF-02 after the local AFK budget or any safety/verification boundary.

## Completed

- Queue migration approved by David.
- AF-01 requirements/evidence gate recorded as approved for implementation using `docs/agentforge/REQUIREMENTS.md` as the working inventory; the unavailable source PDF remains a final-evidence limitation.
- Existing repository tests confirmed: AgentForge 5/5, evals 10/10, observability 5/5.

## Active plan

1. Run review, targeted tests, independent verifier, and local commit for AF-03.
2. Implement AF-05 locally on a branch from the AF-03 stack tip, preserving AF-03 changes.
4. Stop before AF-02/AF-04/AF-06 because they require HITL/external browser or a new UI integration boundary.

## Recovery action

Read `QUEUE.md`, `STACK.md`, this file, the ticket evidence files, and `DECISIONS.md`; inspect `git status --short --branch`; resume with the first incomplete AFK ticket whose blockers are verified.
