# Phase 2 — UI-Layer Audit (forms, screens, pages, controllers)

**Goal:** one long-form, cover-to-cover analysis per UI unit, capturing
structure *and* risk in a single pass.

**Artifacts:** `ui/<UNIT-NAME>.md` per unit (from
`templates/FILE-ANALYSIS.md`), `ui/README.md` (system overview + catalog, from
`templates/LAYER-README.md`), `ui/UI-FLOW.md` (lifecycle phases +
navigation graph; optional SVG/Mermaid under `ui/assets/`).

"UI unit" means whatever the stack's user-facing entry points are: VB6/Delphi
forms, WinForms/WPF windows, JSP/ASP/PHP pages, MVC controllers + their
views, SPA routes/components, CLI commands, public API endpoints. See
`reference/glossary.md`.

## The three steps, per unit

**Step 1 — Read the file.** Open it and read every event handler and every
helper, top to bottom. No skimming. The aim is to be able to narrate the file
without re-opening it. Designer/markup sections count: control properties
(`MaxLength`, visibility, hardcoded captions) are where half the UI bugs hide.

**Step 2 — Find the smells.** Note bugs, dead code, commented-out features,
missing permission checks, hardcoded credentials, mutable globals, raw SQL,
debug overrides left in. Each one becomes a citation: function name in
backticks, line number when it matters.

**Step 3 — Catalog the findings.** Write them in the analysis's
**Findings** table with a provisional severity and category (same scheme as
`templates/BUGS-MITIGATIONS.md`). They are lifted into the global catalog in
Phase 7 — the catalog is the input to the rewrite, not the analysis itself.

## What every UI analysis captures

- **Purpose & lifecycle** — how you get here, load → events → unload, where
  control goes next.
- **Layout / interface** — controls (or routes/params/fields) and what each
  one does; notable properties.
- **State** — module-level variables; **globals it reads or writes**, by
  name.
- **Logic** — one subsection per handler/action, narrated in prose, with
  SQL/queries quoted when they matter.
- **Permission checks** — explicit ones, and the *missing* ones.
- **Data touches** — table/entity × read/write matrix.
- **Cross-links** — which units open this one, which it opens, which
  modules it calls.
- **Findings** — Bug / Security / Smell / Dead code / Half-implemented,
  each with citation, provisional severity, and a one-line mitigation idea.
- **Port notes** — what must survive the rewrite, what must not, and open
  questions for the user.

## Running it

- Work through the Phase 2 queue in `AUDIT-STATE.md` in order. The center
  of gravity goes first.
- For more than ~5 units, fan out: launch `legacy-file-auditor` subagents in
  parallel batches of 3–6 (one unit each), passing: source path, layer
  (`ui`), output path, and the paths to `RECON.md` and `PROJECT-MAP.md`.
  Review each returned analysis before ticking it off — skim for missing
  citations and for findings that are really guesses.
- After the queue is empty, write `ui/README.md` (catalog table: unit,
  purpose, entry points, permission gate, finding counts) and
  `ui/UI-FLOW.md` (the navigation structure — e.g. StarHotel's
  hub-and-spoke — explained in prose, plus a diagram).

## Exit criteria

- [ ] Every unit in the Phase 2 queue has an analysis file
- [ ] Every analysis has citations for every finding
- [ ] `ui/README.md` catalog complete; counts match the queue
- [ ] `ui/UI-FLOW.md` written, center of gravity and navigation primitives explained
- [ ] Open questions collected into `AUDIT-STATE.md` §Open questions
