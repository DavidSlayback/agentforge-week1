# Side Quests

Optional, off-critical-path workstreams related to the rework of
`<Project>` but not required to ship the rewrite described in
`docs/MIGRATION-<ROUTE>.md`. The main migration is the **main quest**; these
are the parallel ambitions, not the homework.

## What counts as a side quest?

At least one of:

- **Doesn't block the main port.** The rewrite can ship without it.
- **Lives outside the rewrite's scope.** Touches the original legacy code, a
  new product surface, third-party integrations, or research spikes.
- **Is speculative.** Worth scoping but not yet committed.

Required for feature parity → it belongs in `docs/arcs/`. A defect found
while reverse-engineering → `docs/BUGS-MITIGATIONS.md`.

## Catalog

| # | Title | Status | One-line |
|---|---|---|---|
| SQ1 | [<Title>](<SLUG>.md) | Idea | |

### Status legend

- **Idea** — captured, not scoped. Mostly *why* and *what*.
- **Scoped** — concrete plan, slice list, effort estimate.
- **In Progress** — someone is working on it; doc tracks state.
- **Done** — shipped; doc kept as a record.
- **Abandoned** — dropped, with a postmortem so nobody repeats the dead end.

## Adding a side quest

1. Pick a kebab-case slug for the filename.
2. Copy `SIDE-QUEST.md` from the legacy-conversion skill templates.
3. Add a catalog row with status `Idea`.
4. If it graduates into the main quest, leave a stub pointing to its arc file.
