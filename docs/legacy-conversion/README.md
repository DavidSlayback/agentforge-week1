# Legacy Codebase Conversion Workflow

A reusable, reverse-first workflow for auditing a legacy codebase and
converting it to a modern system, based on the GauntletAI lecture
*Reverse-Engineering a Legacy Codebase* (StarHotel VB6 case study).

- **Slides (PDF):** [`output/pdf/reverse-engineering-legacy-codebase-slides.pdf`](../../output/pdf/reverse-engineering-legacy-codebase-slides.pdf),
  exported from <https://vb6-legacy-slides.netlify.app/> using the deck's own
  print stylesheet (gradient text and backgrounds are flattened to keep the
  file under the repo's 500 KB large-file hook).
- **Reference repo from the lecture:** <https://github.com/decagondev/vb6-rework-reverse-forward>
  shows what the finished artifacts look like (per-form analyses, a
  150-row bug catalog, route selection, and a slice-loop playbook).
- **Skill:** `legacy-conversion` is a personal skill and is not kept in this
  repository. Its canonical copy lives in the `david-brain` repo at
  `skills/overlays/legacy-conversion/`, and it is synced into the local
  Claude and Codex skill folders (`~/.claude/skills/`, `~/.codex/skills/`)
  with david-brain's `scripts/sync-runtime-skills --authored --apply`.
  Invoke it as `/legacy-conversion`, or `/legacy-conversion requirements <doc>`
  to scope it to a new set of requirements. The david-brain project pack
  `packs/projects/agentforge/` holds this repo's baseline commands and
  safety boundaries.

## The idea in one paragraph

Read and document the legacy system completely *before* changing it. Record
every bug, smell, and design choice with a severity and a mitigation, then
pick a migration route and write a rewrite plan that removes those problems
instead of translating them into a new language. The audit produces a
structured spec, so the rewrite doesn't inherit every bug the original had.
**The audit is the spec.**

```
Legacy source ──▶ LLM-driven audit ──▶ Bug catalog ──▶ Migration spec ──▶ Greenfield rewrite
(no docs/tests)   (per-file prose)     (severity +      (route, stack,     (designs the
                                        mitigation)      arcs, slice loop)  findings out)
```

## The pipeline

| # | Phase | Output |
|---|---|---|
| 0 | **Manual recon.** Read the README, run the app, look over the file tree, and run the existing build, tests and linters to record what already fails. Don't read source yet. | `RECON.md`, `INVENTORY.md`, `BASELINE-ERRORS.md` |
| 1 | **AI scrape.** Start from the build manifest and map every unit and dependency, plus what's missing (tests, CI, backups, monitoring…). When working from requirements, trace each one to the code it touches. *A tree, not a critique.* | `PROJECT-MAP.md`, `project/*.md`, `REQUIREMENTS-TRACE.md` |
| 2 | **UI-layer audit.** Write one long-form analysis per form, page, controller, or screen. | `ui/*.md`, `UI-FLOW.md` |
| 3 | **Module audit.** Cover the business and data logic, globals, and transaction boundaries. | `modules/*.md`, `DATA-FLOW.md` |
| 4 | **Data audit.** Cover the schema, stored logic, seed data, reports, and config. | `data/SCHEMA.md`, `data/REPORTS.md` |
| 5 | **Repo split.** Freeze the original source and keep the docs as their own tree, with an agent brief. | `ORIGINAL-CODE/`, `docs/`, `CLAUDE.md` / `AGENTS.md` |
| 6 | **Deep-dive.** Verify the key claims, cross-link the docs, trace end-to-end walkthroughs, and fill gaps. | `VERIFICATION.md`, walkthroughs |
| 7 | **Bug catalog.** Merge all findings into one list with IDs, severity, category, and mitigation. | `BUGS-MITIGATIONS.md` |
| 8 | **Migration route.** Score 3–5 routes; the highest score wins unless a written override explains why not. Write its playbook. | `MIGRATION-OPTIONS.md`, `MIGRATION-<ROUTE>.md` |
| 9 | **Side quests.** Park nice-to-haves and new features outside the critical path. | `sidequests/` |
| 10 | **Vertical slices.** Build a walking skeleton first, then one slice per user flow or requirement, end to end (UI → logic → data → tests). Each slice is tested, reviewed, and closes catalog rows. | code, `arcs/`, `DEV-LOG.md` |

Each phase produces an artifact the next phase builds on. Don't skip phases,
and don't loop back except to correct an artifact.

## Applying it to this repository

OpenEMR is an in-place modernization rather than a rewrite in a separate
repo. The skill's `references/scaling.md` covers this case: pin a
`legacy-baseline` tag instead of copying the source into `ORIGINAL-CODE/`,
keep audit docs in their own tree (for example
`docs/legacy-audit/<subsystem>/`), and compare refactoring strategies in
Phase 8 rather than languages.

Note: the workflow is based on the slides and the lecture's reference repo.
The accompanying lecture video wasn't available, so anything covered only in
the video isn't included.
