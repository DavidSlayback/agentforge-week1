# Prompt Patterns

Driving an LLM well is a skill. You are playing an instrument, not praying to
an oracle. Every good prompt in this workflow has four parts:

1. **Input scope** — exactly which files/artifacts to read.
2. **One bounded job** — a single verb (map, narrate, list, verify, compare).
3. **Named output** — the file and template to write, or the exact shape
   to return.
4. **Explicit non-goals** — what *not* to do (usually: don't critique yet,
   don't fix, don't guess).

## The masterclass (from the lecture, Phase 1)

| Verdict | Prompt | Why |
|---|---|---|
| ✓ Just right | "Start with `StarHotel.vbp`. Identify the entry point, every form, every module, every COM dependency. Produce a tree, not a critique." | Bounded input, one job, named output, explicit non-goal. |
| ✗ Too vague | "Tell me about this codebase." | No scope, no target output → a generic essay. |
| ✗ Too eager | "Find all the bugs and rewrite this in modern C#." | It guesses, hallucinates, and skips to fixes for problems it hasn't found. |

## Per-phase patterns

Replace `<...>` placeholders. Each is one bounded job.

### Phase 0 — Recon (brief the model with what you observed)

> Here is `RECON.md` (what I saw running the app) and `INVENTORY.md`
> (file/LOC counts). Don't read source yet. List the questions a newcomer
> should answer before auditing this codebase, grouped by UI, data,
> security, and deployment. Output a checklist I can paste into
> `AUDIT-STATE.md` §Open questions.

### Phase 1 — Map

> Start with `<manifest path>`. Identify the entry point, every UI unit,
> every module, every external dependency with version. Produce a tree, not
> a critique. Write it to `docs/PROJECT-MAP.md` using the template at
> `.claude/skills/legacy-conversion/templates/PROJECT-MAP.md`. Mark files in
> the source tree that are not referenced by the manifest.

> Walk `<manifest path>` line by line. For each directive, explain what it
> means and flag anything unusual or deprecated. Write
> `docs/project/<NAME>.md`. No recommendations.

### Phases 2–4 — Per-unit audit

> Read `<source path>` cover to cover — every handler and helper, including
> designer/markup properties. Write `docs/<layer>/<NAME>.md` using the
> FILE-ANALYSIS template. Narrate behavior in long-form prose; cite every
> claim with the function name in backticks and a line number when it
> matters. List globals read/written, permission checks present *and
> missing*, and table reads/writes. Record findings with provisional
> severity. Do not propose code; mitigations are one line each.

> In `<source path>`, list every place a global/shared variable is read or
> written, as a table: variable, function, read/write, line. Nothing else.

### Phase 6 — Deep-dive

> Claim under test (from `docs/<file>.md`): "<claim>". Open the cited
> source, confirm or refute it with exact lines, and update both the
> analysis and `docs/VERIFICATION.md`. If refuted, rewrite the claim; do not
> delete the history row.

> Trace "<business operation>" end to end: UI event → module calls → SQL →
> tables, as a numbered sequence with citations. Write it to
> `docs/walkthroughs/<SLUG>.md`. Note every point where a partial failure
> would leave inconsistent data.

> Grep `docs/` for every mention of `<unit>`. List analyses that mention it
> without a reciprocal link, and add the missing cross-links.

### Phase 7 — Catalog

> Harvest every Findings row from `docs/ui/`, `docs/modules/`,
> `docs/data/`, `docs/project/`. Merge duplicates (same root cause) into one
> entry with multiple locations. Output `docs/BUGS-MITIGATIONS.md` per the
> template, with IDs, final severity, and a concrete mitigation naming the
> replacement technique. Report any Critical/High entry lacking a
> `(verified)` mark.

### Phase 8 — Routes

> Using `docs/BUGS-MITIGATIONS.md` counts, `docs/INVENTORY.md` sizes, and
> these decision-dimension answers: <answers>, evaluate these routes:
> <A..E>. For each: pros, cons, phased roadmap, tooling, effort range, and
> which catalog IDs it inherits vs designs out. Then a weighted scoring
> table with weights <weights>. Recommend one. Write
> `docs/MIGRATION-OPTIONS.md`.

### Phase 10 — Slice

> Start slice `<NN-SS-LL>` from `docs/arcs/ARC-NN-*.md`. Read the playbook,
> the arc file, the last 5 DEV-LOG entries, and catalog IDs <ids>. Write a
> slice plan first and stop for confirmation if anything is ambiguous.

## Anti-patterns to catch in your own prompts

- **Two jobs in one prompt** ("map and critique") — the second job starves
  the first.
- **No output file** — the answer lives in scrollback and is lost.
- **Asking for fixes during the read pass** — produces fixes for guessed
  problems.
- **Re-deriving context every session** — put it in `CLAUDE.md` and
  `AUDIT-STATE.md` instead.
