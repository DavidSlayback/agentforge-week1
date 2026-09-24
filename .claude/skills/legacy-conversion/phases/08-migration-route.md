# Phase 8 — Migration Route (evaluate several, choose one, write the playbook)

**Goal:** instead of picking a stack first, tally the findings, score
candidate routes against the constraints that actually matter, and pick the
one whose weaknesses you can live with. Then turn that choice into an
executable plan.

**Artifacts:**

- `MIGRATION-OPTIONS.md` (from `templates/MIGRATION-OPTIONS.md`) — route
  selection.
- `MIGRATION-<ROUTE>.md` (from `templates/MIGRATION-PLAYBOOK.md`) — the
  implementation playbook for the chosen route.
- `arcs/README.md` (from `templates/ARCS-README.md`) and `DEV-LOG.md` (from
  `templates/DEV-LOG.md`), created empty-but-structured.

## Part A — Route selection (`MIGRATION-OPTIONS.md`)

1. **Tally.** Pull counts by severity/category from `BUGS-MITIGATIONS.md`
   and the size figures from `INVENTORY.md`.
2. **Decision dimensions — ask the user.** Route choice depends almost
   entirely on these; don't guess them. Use one `AskUserQuestion` call for
   the ones you can't infer: UX paradigm (stay desktop / web / mobile),
   team language, deployment target, reporting fidelity (pixel-perfect
   vs. redesign), risk tolerance (big-bang / parallel run / strangler fig),
   budget (commercial migration tooling on the table?), timeline pressure
   (runtime EOL dates from Phase 1).
3. **"What every route must replace."** List the decisions that exist
   regardless of target: the database engine, the report engine, the
   auth/crypto model, disabled features (fix or design out), config and
   storage paths, integrations.
4. **Evaluate 3–5 routes.** Always include:
   - an **incremental / automated-translation** route (vendor migrator,
     transpiler, or in-place refactor) — it is the baseline, and it
     *inherits the catalog*;
   - a **greenfield rewrite in the ecosystem closest to the team** — it
     *designs the catalog out*;
   - 1–3 alternatives the dimensions make plausible.
   Per route: summary, pros, cons, phased roadmap, tooling, effort range,
   and **which catalog entries it inherits vs. designs out**.
5. **Score.** Weighted matrix: dimensions × routes, weights agreed with the
   user. Show the arithmetic. Add a side-by-side comparison table and a note
   on hybrids (e.g. strangler fig).
6. **Recommend** one route with an explicit rationale tied to the numbers
   (StarHotel: "small enough that the migrator's licence costs more than
   the time it saves — and 150 bugs are easier to design out than to fix").
   Record the decision and date in `AUDIT-STATE.md` and ask the user to
   confirm before Part B.
7. **"First steps regardless of route"** — the no-regret moves (data export
   tooling, freezing the schema, characterization tests where the legacy
   app can run).

## Part B — Playbook (`MIGRATION-<ROUTE>.md`)

The single source of truth for **how** the rewrite happens:

- Purpose & scope (what's in, what's explicitly out).
- Target architecture — layer model with one-way dependencies; how each
  Architectural-Smell entry in the catalog is designed out (table:
  catalog ID → design decision).
- Solution/project structure; tech stack with rationale per choice.
- Coding standards; test strategy (unit, integration, smoke, regression /
  characterization against the Phase 6 transaction walkthroughs) and the
  **test gates per slice**.
- Required documentation artifacts (`DEV-LOG.md`, arc files, catalog kept
  current).
- Git workflow — branch naming, conventional commits, protection, tags.
- **The slice loop** (see `phases/10-forward-slice-loop.md`).
- Epic/Story/Slice hierarchy and sizing rules.
- **Roadmap of arcs** — typically: Foundation → Data → Auth/Sessions →
  Domain Core → Reports → Presentation Foundation → feature UIs (one arc
  per cluster from `ui/README.md`) → Cross-cutting → Data Migration Tooling
  → Polish & Hardening → Release. Every catalog entry must map to an arc,
  or be explicitly marked *won't carry forward*.
- Templates (arc file, DEV-LOG entry, slice plan) and Definitions of Done
  (slice, story, arc, project).

## Exit criteria

- [ ] Decision dimensions answered by the user and recorded
- [ ] ≥3 routes evaluated with pros/cons/roadmap/tooling/effort and inherited-vs-designed-out analysis
- [ ] Weighted scoring shown; recommendation made and confirmed by the user
- [ ] Playbook written; every catalog entry mapped to an arc or marked won't-carry
- [ ] `arcs/README.md` roadmap table and empty `DEV-LOG.md` created
