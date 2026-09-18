# AgentForge AFK checkpoint

**State:** `NEEDS_HUMAN` at AF-07 after AF-06 external verification; stop here.

## Completed

- Queue migration approved by David.
- AF-01 requirements/evidence gate recorded as approved for implementation using `docs/agentforge/REQUIREMENTS.md` as the working inventory; the unavailable source PDF remains a final-evidence limitation.
- Existing repository tests confirmed: AgentForge 5/5, evals 10/10, observability 5/5.
- AF-02 canonical Railway HTTPS origin externally verified at `https://agentforge-week1-production.up.railway.app`; route matrix and fresh-browser interaction passed.
- AF-06 evaluator/operations panel externally verified at the same origin; saved golden and mutation evidence are discoverable and all linked routes passed.

## Active plan

1. Resolve AF-07 through the required fresh external release verification.
2. Do not start AF-08 until AF-07 is explicitly cleared.

## Recovery action

Read `QUEUE.md`, `STACK.md`, this file, the ticket evidence files, and `DECISIONS.md`; inspect `git status --short --branch`; resume at AF-07 only after its external release-verification boundary is satisfied.
