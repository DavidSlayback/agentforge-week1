# Legacy Codebase Conversion Workflow

A reusable, reverse-first workflow for auditing a legacy codebase and
converting it to a modern system. It is packaged as a Claude Code skill so
any session in this repository can run it, and it generalizes the pipeline
taught in the GauntletAI lecture *Reverse-Engineering a Legacy Codebase*
(StarHotel VB6 case study).

- **Slides (PDF):** [`output/pdf/reverse-engineering-legacy-codebase-slides.pdf`](../../output/pdf/reverse-engineering-legacy-codebase-slides.pdf),
  exported from <https://vb6-legacy-slides.netlify.app/> using the deck's own
  print stylesheet (gradient text and backgrounds are flattened to keep the
  file under the repo's 500 KB large-file hook).
- **Reference repo from the lecture:** <https://github.com/decagondev/vb6-rework-reverse-forward>
  shows what the finished artifacts look like (per-form analyses, a
  150-row bug catalog, route selection, and a slice-loop playbook).
- **Skill:** [`.claude/skills/legacy-conversion/`](../../.claude/skills/legacy-conversion/SKILL.md),
  invoked as `/legacy-conversion`.
- **Subagent:** [`.claude/agents/legacy-file-auditor.md`](../../.claude/agents/legacy-file-auditor.md)
  handles parallel per-file audits.

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
| 0 | **Manual recon.** Read the README, run the app, look over the file tree. Don't read source yet. | `RECON.md`, `INVENTORY.md` |
| 1 | **AI scrape.** Start from the build manifest and map every unit and dependency. *A tree, not a critique.* | `PROJECT-MAP.md`, `project/*.md` |
| 2 | **UI-layer audit.** Write one long-form analysis per form, page, controller, or screen. | `ui/*.md`, `UI-FLOW.md` |
| 3 | **Module audit.** Cover the business and data logic, globals, and transaction boundaries. | `modules/*.md`, `DATA-FLOW.md` |
| 4 | **Data audit.** Cover the schema, stored logic, seed data, reports, and config. | `data/SCHEMA.md`, `data/REPORTS.md` |
| 5 | **Repo split.** Freeze the original source and keep the docs as their own tree, with a `CLAUDE.md` brief. | `ORIGINAL-CODE/`, `docs/`, `CLAUDE.md` |
| 6 | **Deep-dive.** Verify the key claims, cross-link the docs, trace end-to-end walkthroughs, and fill gaps. | `VERIFICATION.md`, walkthroughs |
| 7 | **Bug catalog.** Merge all findings into one list with IDs, severity, category, and mitigation. | `BUGS-MITIGATIONS.md` |
| 8 | **Migration route.** Score 3–5 routes, choose one, and write its playbook. | `MIGRATION-OPTIONS.md`, `MIGRATION-<ROUTE>.md` |
| 9 | **Side quests.** Park nice-to-haves and new features outside the critical path. | `sidequests/` |
| 10 | **Forward slice loop.** Work arc → story → slice. Each slice is fully tested and reviewed, and resolves catalog rows. | code, `arcs/`, `DEV-LOG.md` |

Each phase produces an artifact the next phase builds on. Don't skip phases,
and don't loop back except to correct an artifact.

## How to use it

```text
/legacy-conversion                # find or create AUDIT-STATE.md and report where things stand
/legacy-conversion phase 0        # run a phase (the skill won't skip ahead past open exit criteria)
/legacy-conversion next           # do the next bounded job in the current phase
/legacy-conversion audit <path>   # per-file analysis of one unit
/legacy-conversion slice 01-01-01 # one iteration of the forward slice loop
```

Deterministic inventory (no LLM involved):

```bash
python3 .claude/skills/legacy-conversion/scripts/inventory.py <source-root> --churn > <docs-root>/INVENTORY.md
```

## What is in the skill

| Path | Contents |
|---|---|
| `SKILL.md` | Operating rules, state-file protocol, argument handling, and the phase table |
| `phases/00-…10-*.md` | Procedure and exit criteria for each phase |
| `reference/prompts.md` | Prompt patterns for each phase: "just right", "too vague", and "too eager" |
| `reference/scaling.md` | How to choose the unit of analysis for 5K to 5M lines, how to fan out, and in-place modernization |
| `reference/glossary.md` | How the lecture's VB6 terms map onto other stacks |
| `templates/` | 17 artifact skeletons: state file, recon, map, per-file analysis, schema, reports, verification log, bug catalog, route options, playbook, arcs, dev log, side quests, audit `CLAUDE.md` |
| `scripts/inventory.py` | File, LOC, manifest, binary, and churn inventory (standard library only) |

## Notes

- The workflow is based on the slides and the lecture's reference repo. The
  accompanying lecture video wasn't available here, so anything covered only
  in the video isn't included yet.
- The skill works on any stack. The lecture's VB6 examples, such as `.vbp`
  files, forms, and Crystal Reports, appear only as worked examples.
  `reference/glossary.md` gives the equivalents for other stacks.
- For an in-place modernization inside a large repo like this one,
  `reference/scaling.md` explains how to replace the frozen `ORIGINAL-CODE/`
  copy with a pinned baseline tag and how to compare refactoring strategies
  instead of languages.
