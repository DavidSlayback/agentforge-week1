# Audit State — <Project name>

Single source of truth for where this conversion stands. Any session (human
or LLM) resumes from this file. Update it at the end of every working turn.

| Field | Value |
|---|---|
| Legacy source root (read-only) | `<path>` |
| Upstream / provenance | `<url @ ref>`, license `<license>` |
| Docs root | `<path>` |
| App runnable locally? | yes / no — `<how>` |
| Unit of analysis | per file / per feature / per subsystem — `<why>` (see `reference/scaling.md`) |
| Exclusions | `<vendored libs, generated code, ...>` |
| Current phase | 0 — Manual recon |
| Chosen route | _(Phase 8)_ |

## Phase status

| # | Phase | Status | Artifact(s) |
|---|---|---|---|
| 0 | Manual recon | not started | `RECON.md`, `INVENTORY.md` |
| 1 | AI scrape | not started | `PROJECT-MAP.md`, `project/*.md` |
| 2 | UI-layer audit | not started | `ui/*.md` |
| 3 | Module audit | not started | `modules/*.md` |
| 4 | Data audit | not started | `data/*.md` |
| 5 | Repo split | not started | `ORIGINAL-CODE/`, `CLAUDE.md`, `README.md` |
| 6 | Deep-dive | not started | `VERIFICATION.md`, walkthroughs |
| 7 | Bug catalog | not started | `BUGS-MITIGATIONS.md` |
| 8 | Migration route | not started | `MIGRATION-OPTIONS.md`, `MIGRATION-<ROUTE>.md` |
| 9 | Side quests | not started | `sidequests/` |
| 10 | Forward slice loop | not started | `arcs/`, `DEV-LOG.md`, code |

Status values: `not started` | `in progress` | `complete` | `corrected` (re-opened to fix an artifact; say why in the log).

## Current phase exit criteria

_Copy the checklist from the active `phases/NN-*.md` here and tick as you go._

- [ ] ...

## Layer mapping (from Phase 1)

| Source path / pattern | Layer | Notes |
|---|---|---|
| `<Form/*.frm>` | ui | |
| `<Module/*.bas>` | modules | |
| `<schema / reports>` | data | |
| `<vendor/>` | excluded | third-party |

## Work queues

### Phase 2 — UI units
- [ ] `<source path>` → `ui/<NAME>.md` (<LOC> lines) — center of gravity

### Phase 3 — Modules
- [ ] `<source path>` → `modules/<NAME>.md` (<LOC> lines)

### Phase 4 — Data assets
- [ ] schema → `data/SCHEMA.md`
- [ ] reports → `data/REPORTS.md`

## Decisions

| Date | Decision | Rationale |
|---|---|---|
| YYYY-MM-DD | | |

## Open questions

- [ ] _(questions for the user / domain experts; link the analysis that raised each)_

## Phase log

_Append-only, newest last._

- YYYY-MM-DD — Phase 0 started.
