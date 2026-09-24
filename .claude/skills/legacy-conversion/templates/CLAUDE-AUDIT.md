# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Repository purpose

A **reverse-then-forward** rework of `<Project>` (<vendor>, <years>). The
repo holds:

- `ORIGINAL-CODE/<name>/` — the unmodified upstream source, a frozen
  reference. **Do not edit files here.**
- `docs/` — the reverse-engineering knowledge base: one long-form analysis
  per UI unit, module, and data asset, plus the bug catalog and migration
  plan. Progress is tracked in `docs/AUDIT-STATE.md`.
- `src/`, `tests/`, `tools/` — the rewrite (once Phase 10 begins).

Use the `/legacy-conversion` skill for all audit and slice work.

## Build / run / test

- **Original:** <how to build/run the legacy app, even if only on a legacy OS; where the prebuilt artifacts are>.
- **Docs:** plain Markdown; no build.
- **Rewrite:** <gates from the playbook, once it exists>.

## Documentation structure

- `docs/ui/` — per-UI-unit analyses, `README.md` (catalog), `UI-FLOW.md`.
- `docs/modules/` — per-module analyses, `README.md`, `DATA-FLOW.md`.
- `docs/data/` — `SCHEMA.md`, `REPORTS.md`, other data assets.
- `docs/project/` — build/packaging artifact analyses.
- `docs/BUGS-MITIGATIONS.md` — the triage list. When a new finding is
  added to an analysis, also add it here and bump the summary counts.
- `docs/MIGRATION-OPTIONS.md`, `docs/MIGRATION-<ROUTE>.md`, `docs/arcs/`,
  `docs/DEV-LOG.md` — route selection, playbook, arc plans, journal.
- Diagrams live as `.svg` under each section's `assets/`, paired with a `.md`.

**Doc voice:** long-form prose; named code citations (function names in
backticks, `path:line` when it matters); tables for catalogs; explicit
call-outs of bugs, smells, and legacy artifacts; flag what should and
shouldn't survive the port. Preserve in-source dates and version numbers
when citing module headers.

## Application architecture (essentials)

The load-bearing facts any doc or port must preserve. Read `docs/` for nuance.

- **Entry point.** <e.g. `Sub Main` in `modMain.bas`, not a startup form; boot sequence>
- **Navigation shape.** <e.g. hub-and-spoke around the dashboard>
- **Defining architectural choice.** <e.g. SQL builder mutating global `gstrSQL`>
- **Data access.** <connections, read vs write paths, transaction boundaries>
- **Globals as session state.** <which globals; who reads them>
- **Security model.** <hashing, credentials, permission matrix; catalog §1–3 counts>
- **Reports.** <engine, registration mechanism>
- **Soft delete / audit trails.**
- **Error logging.** <paths and fallbacks>

## Repo conventions

- Never modify `ORIGINAL-CODE/`.
- Focused commits, one per doc or layer (`docs(ui): document login form`).
- Keep `docs/AUDIT-STATE.md` current at the end of every working session.
