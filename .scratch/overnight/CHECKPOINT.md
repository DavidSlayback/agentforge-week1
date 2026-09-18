# AgentForge AFK checkpoint

**State:** `NEEDS_HUMAN` at AF-08 after AF-07 owner sign-off and GitLab closure; stop here.

## Completed

- Queue migration approved by David.
- AF-01 requirements/evidence gate recorded as approved for implementation using `docs/agentforge/REQUIREMENTS.md` as the working inventory; the unavailable source PDF remains a final-evidence limitation.
- Existing repository tests confirmed: AgentForge 5/5, evals 10/10, observability 5/5.
- AF-02 canonical Railway HTTPS origin externally verified at `https://agentforge-week1-production.up.railway.app`; route matrix and fresh-browser interaction passed.
- AF-06 evaluator/operations panel externally verified at the same origin; saved golden and mutation evidence are discoverable and all linked routes passed.
- AF-07 owner sign-off recorded after a fresh-browser rehearsal: briefing, follow-up, blocked cross-patient probe, evaluator evidence, operational links, and synthetic-only limitations all passed.
- AF-08 decision inputs recorded: synthetic forever, no PHI, provider deferred, and production-like resilience required; the gate remains inconclusive until resilience and independent evidence exist.
- AF-08 resilience foundation tested locally and deployed: durable redacted traces, retention/deletion, backup/restore, alert evaluation, isolated evaluator state, restart persistence, public route smoke, and API collection pass; external recovery/rollback/alert evidence remains open.

## Active plan

1. Continue AF-08 with backup/restore, rollback, incident/alert drills, and independent evidence.
2. Do not start AF-09 until AF-08 is explicitly cleared.

## Recovery action

Read `QUEUE.md`, `STACK.md`, this file, the ticket evidence files, and `DECISIONS.md`; inspect `git status --short --branch`; resume at AF-08 only after its signed privacy/security review boundary is satisfied.
