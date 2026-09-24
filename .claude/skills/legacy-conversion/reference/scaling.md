# Scaling the Audit: Unit of Analysis, Scope, and Fan-out

The lecture's case study is ~13K behavioral lines in 23 source files — small
enough for one analysis per file. Most real legacy systems are bigger. Pick
the unit of analysis from `INVENTORY.md` and record the choice in
`AUDIT-STATE.md`.

## Choosing the unit

| Behavioral LOC (excl. vendored/generated) | Unit of analysis | Expected analyses |
|---|---|---|
| < 30K | **One file** per analysis (the lecture's approach) | 10–60 |
| 30K – 250K | **One feature / directory** per analysis; per-file only for the center of gravity, auth, and data access | 30–120 |
| 250K – 2M | **One subsystem** per analysis, with a subsystem map; per-feature docs only for the subsystems in migration scope | 20–80 + deep dives |
| > 2M | **Scope first.** Pick the bounded context being converted (one module, one product line) and treat the rest as external dependencies with documented interfaces | per scoped subsystem |

Rules of thumb:

- An analysis that can't be read in ~10 minutes covers too much; split it.
- One that says nothing a reader couldn't guess from the file name covers
  too little; merge it into its feature.
- Always go per-file for: the entry point, the center of gravity, anything
  touching credentials/crypto/money/PHI, and the data-access core.

## Prioritizing the queue

Order by (highest first):

1. Center of gravity (from Phase 0).
2. Security-sensitive units (auth, session, permissions, crypto).
3. Data access / query building.
4. High-traffic transactional flows.
5. Git churn hot spots (`inventory.py --churn`) — code that changes often
   is code that breaks often.
6. Admin/maintenance screens.
7. Leaf utilities.

Read last (or exclude with a note): generated code, designer boilerplate,
vendored third-party code, test fixtures, minified assets.

## Fan-out with subagents

For Phases 2–4, launch the `legacy-file-auditor` subagent once per unit:

- Batches of 3–6 in parallel; review each batch before the next.
- Each subagent gets: source path, layer, output path, and the paths to
  `RECON.md`, `PROJECT-MAP.md`, and `CLAUDE.md` (if the split is done).
- Each returns its findings summary; append those to the analysis and tick
  the queue in `AUDIT-STATE.md` yourself — subagents don't edit the state
  file (avoids write races).
- Cross-links and the layer `README.md` are written by the orchestrator
  after the batch, not by the subagents.

## In-place modernization (legacy and rewrite share a repo)

When the system is modernized in place rather than rewritten (e.g. moving a
PHP monolith's procedural `library/` code into typed `src/` services):

- Replace Phase 5's `ORIGINAL-CODE/` copy with a pinned tag
  (`legacy-baseline`) and cite `path:line@legacy-baseline`.
- Keep audit docs in their own tree (e.g. `docs/legacy-audit/<subsystem>/`).
- Route evaluation in Phase 8 compares *refactoring strategies* (strangler
  fig behind an interface, extract-service, rewrite-module, leave-as-is)
  rather than languages; the rest of the pipeline is unchanged.
