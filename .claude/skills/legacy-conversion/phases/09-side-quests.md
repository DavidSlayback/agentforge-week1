# Phase 9 — Side Quests (nice-to-haves & new features)

**Goal:** give every good idea that surfaced during the audit a home that is
*not* the critical path, so the main rewrite stays scoped to parity plus
catalog resolution.

**Artifacts:** `sidequests/README.md` (catalog, from
`templates/SIDEQUESTS-README.md`) and one `sidequests/<SLUG>.md` per quest
(from `templates/SIDE-QUEST.md`).

## What counts as a side quest

At least one of:

- **Doesn't block the main port** — the rewrite ships without it.
- **Lives outside the rewrite's scope** — patching the frozen legacy app for
  sites still on it, new product surfaces (portals, mobile), third-party
  integrations, AI features, research spikes.
- **Is speculative** — worth scoping, not yet committed.

Not side quests: anything required for feature parity (→ an arc), and any
defect found in the legacy code (→ `BUGS-MITIGATIONS.md`).

Typical first three: (1) surgical back-port of Critical fixes to the legacy
build for sites that can't wait for the rewrite, (2) an LLM/assistant
feature on the new stack, (3) a new user-facing surface (self-service
portal, API).

## Procedure

1. Sweep `AUDIT-STATE.md` §Open questions, analyses' Port notes, and the
   conversation for feature ideas; list them.
2. For each: write the side-quest doc — Concept, Why it's a side quest,
   Scope (in / out), Dependencies on the main quest (which arcs), Sketch of
   approach, Effort estimate with assumptions, Risks & open questions.
3. Add a catalog row with status `Idea`. Status lifecycle:
   Idea → Scoped → In Progress → Done | Abandoned (with postmortem).
4. If a quest graduates into the main quest, leave a stub pointing at its
   arc file.

## Exit criteria

- [ ] Every surfaced idea is either a side quest, an arc item, or explicitly dropped
- [ ] `sidequests/README.md` catalog table complete with statuses
