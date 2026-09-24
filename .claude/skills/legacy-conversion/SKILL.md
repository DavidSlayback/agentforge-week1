---
name: legacy-conversion
description: Reverse-first audit and conversion workflow for legacy codebases. Use when asked to audit, reverse-engineer, document, modernize, port, migrate, or rewrite an unfamiliar or legacy codebase (VB6, Delphi, COBOL, classic ASP, old PHP/Java/.NET, jQuery-era JS, etc.), or to resume a conversion already tracked by an AUDIT-STATE.md file. Drives ten phases — manual recon, AI scrape, UI-layer audit, module audit, data audit, repo split, deep-dive, bug catalog, migration-route selection, side quests — then the forward slice loop for the rewrite.
argument-hint: "[status | phase <N> | next | audit <path> | slice <id>]"
---

# Legacy Conversion — Reverse-First Audit Pipeline

**The audit is the spec.** Understand the legacy system completely *before*
changing it, catalog everything wrong with it, and design a rewrite that
removes those problems instead of translating them into a newer language.
A line-for-line port inherits every bug the original ever had; a
reverse-first audit gives the rewrite team a chart, not a guess.

This workflow generalizes the pipeline from the GauntletAI lecture
*Reverse-Engineering a Legacy Codebase* (StarHotel VB6 case study; reference
repo `github.com/decagondev/vb6-rework-reverse-forward`). The deck is saved
at `output/pdf/reverse-engineering-legacy-codebase-slides.pdf`.

## Operating rules (apply in every phase)

1. **Map first, opine later.** The audit is a read pass. Fixes happen in the
   rewrite. Never "fix while reading" and never edit the legacy source.
2. **One bounded job at a time, with a named output.** Every step below
   names the artifact it produces. If you can't name the output, the job is
   too vague (see `reference/prompts.md`).
3. **Each phase produces an artifact the next phase leans on. Don't skip;
   don't loop.** Only advance when the phase's exit criteria are met. Going
   back is allowed only to *correct* an artifact — record why in
   `AUDIT-STATE.md`.
4. **Cite everything.** Every claim about behavior names its source:
   `` `FunctionName` `` in backticks, `path/to/file.ext:line` when the line
   matters. A finding with no citation is a rumor.
5. **Verify the load-bearing claims.** Every Critical/High finding is
   re-checked against the source by a second read and marked `(verified)`.
6. **Legacy code is evidence, not a standard.** Describe what it does,
   including the ugly parts, in long-form prose. Flag what should and should
   not survive the port.

## Step 0 — Always: locate or create the state file

The whole conversion is tracked in one file, `AUDIT-STATE.md`, at the root
of the audit workspace (the docs repo or `docs/` folder that holds the
analyses).

1. Search for an existing `AUDIT-STATE.md` (`Glob **/AUDIT-STATE.md`,
   skipping `vendor/`, `node_modules/`).
2. **Found →** read it, report the current phase and its open exit
   criteria, then continue with the requested action.
3. **Not found →** ask the user (one `AskUserQuestion` call) for anything you
   cannot infer: the legacy source root, where the audit docs should live,
   and whether the app can be run locally. Then copy
   `templates/AUDIT-STATE.md` into place and fill in the header.

Keep `AUDIT-STATE.md` current: tick exit criteria as they are met, append a
line to its **Phase log** whenever a phase starts or completes, and record
every scoping decision (unit of analysis, exclusions, layer mapping).

## Arguments

| Invocation | Action |
|---|---|
| *(none)* or `status` | Step 0, then summarize: current phase, artifacts done/missing, next bounded job. |
| `next` | Do the next unchecked bounded job in the current phase. |
| `phase <N>` | Load `phases/<NN>-*.md` and run that phase (refuse to skip ahead if earlier exit criteria are open; say which). |
| `audit <path>` | Per-file analysis of one source file/unit (Phase 2/3/4 procedure). |
| `slice <id>` | Run one iteration of the forward slice loop (Phase 10). |

## The pipeline

Read the phase file **before** starting a phase — each holds the procedure,
the artifact template to use, and the exit criteria.

| # | Phase | Job | Artifact (under the docs root) | Phase file |
|---|---|---|---|---|
| 0 | Manual recon | README, run the app, eyeball the tree. No source reading. | `RECON.md` | `phases/00-manual-recon.md` |
| 1 | AI scrape | Read the build manifest; map entry point, every UI unit, every module, every external dependency. *A tree, not a critique.* | `PROJECT-MAP.md`, `project/<MANIFEST>.md` | `phases/01-ai-scrape.md` |
| 2 | UI-layer audit | One long-form analysis per screen/form/page/controller. | `ui/<NAME>.md`, `ui/README.md`, `ui/UI-FLOW.md` | `phases/02-ui-layer-audit.md` |
| 3 | Module audit | One analysis per business/data-logic module. | `modules/<NAME>.md`, `modules/README.md`, `modules/DATA-FLOW.md` | `phases/03-module-audit.md` |
| 4 | Data audit | Schema, stored logic, reports, config, file formats. | `data/SCHEMA.md`, `data/REPORTS.md`, `data/<...>.md` | `phases/04-data-audit.md` |
| 5 | Repo split | Freeze the original source; docs become their own tree. | `ORIGINAL-CODE/` (read-only) + `docs/` + `CLAUDE.md` | `phases/05-repo-split.md` |
| 6 | Deep-dive | Claude Code + skills over the split repo: verify, cross-link, fill gaps, diagram. | Updated analyses, `VERIFICATION.md` | `phases/06-deep-dive.md` |
| 7 | Bug catalog | Lift every finding into one triaged list: severity, category, mitigation. | `BUGS-MITIGATIONS.md` | `phases/07-bug-catalog.md` |
| 8 | Migration route | Evaluate ≥3 (ideally 5) routes against weighted dimensions; choose one; write its playbook. | `MIGRATION-OPTIONS.md`, `MIGRATION-<ROUTE>.md`, `arcs/README.md`, `DEV-LOG.md` | `phases/08-migration-route.md` |
| 9 | Side quests | Park nice-to-haves and new features off the critical path. | `sidequests/README.md`, `sidequests/<SLUG>.md` | `phases/09-side-quests.md` |
| 10 | Forward: slice loop | Build the rewrite arc → story → slice, each slice resolving catalog rows. | Code + tests + `DEV-LOG.md` entries + `arcs/ARC-NN-*.md` | `phases/10-forward-slice-loop.md` |

Supporting material:

- `reference/prompts.md` — prompt patterns per phase ("just right" vs "too
  vague" vs "too eager").
- `reference/scaling.md` — choosing the unit of analysis and scoping for
  codebases from 5K to 5M lines; parallel fan-out with subagents.
- `reference/glossary.md` — how the lecture's VB6 vocabulary (`.vbp`, forms,
  `.bas` modules, Crystal Reports, "run the EXE") maps onto other stacks.
- `templates/` — every artifact's skeleton. Copy, then fill in; do not invent
  new structures when a template exists.
- `scripts/inventory.py` — deterministic file/LOC/manifest/binary/churn
  inventory for Phases 0–1:
  `python3 .claude/skills/legacy-conversion/scripts/inventory.py <source-root> [--churn] > <docs-root>/INVENTORY.md`
- Subagent `legacy-file-auditor` (`.claude/agents/legacy-file-auditor.md`) —
  audits one source unit into one analysis file. Use it to fan out Phases
  2–4 in parallel batches.

## Handoff format

End every working turn with a short status block so a fresh session (human
or LLM) can resume from `AUDIT-STATE.md` alone:

```
Phase <N> — <name>: <k>/<n> exit criteria met
Produced: <artifacts written or updated this turn>
Findings added: <count by severity, if any>
Next bounded job: <one sentence, naming its output file>
```
