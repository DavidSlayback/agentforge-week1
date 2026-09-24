# Phase 10 — Forward: the Slice Loop

**Goal:** build the rewrite one small, reviewable, fully-tested slice at a
time, each slice traceable to the arc plan and to the catalog entries it
resolves. One branch, one slice, one log entry at a time.

**Artifacts per slice:** code + tests on a slice branch, one new
`DEV-LOG.md` entry, arc file checkbox ticked, resolved catalog entries
struck through with the slice ID.

## Hierarchy and sizing

- **Arc** (epic) — a roadmap row from the playbook. Its file
  `arcs/ARC-NN-NAME.md` (from `templates/ARC.md`) is written **before** its
  first slice: goal, out of scope, catalog entries resolved, stories,
  slices, acceptance criteria, arc DoD.
- **Story** — a user-visible or architecturally complete capability.
- **Slice** — 1–3 days, ≤ ~500 lines of meaningful diff, independently
  green. ID format `NN-SS-LL` (arc-story-slice).

## Roles

- **Implementer** (Claude Code or a developer): creates the slice branch,
  writes code, tests, and doc updates, runs the gates, presents the diff.
- **Reviewer** (the user): reviews, stages/commits, merges. **The
  implementer never commits to, pushes to, or merges into `main`.**

## Step-by-step (`/legacy-conversion slice <id>`)

1. **Load context.** Read the playbook, the active arc file, the last 3–5
   `DEV-LOG.md` entries, the catalog entries the slice references, and the
   legacy analyses for the behavior being rebuilt (and the legacy source
   when a detail matters).
2. **Plan.** Write a short slice plan (template in the playbook): intent,
   files to touch, tests to add, catalog IDs resolved, acceptance criteria.
   Confirm with the user if the slice is ambiguous.
3. **Branch.** `git checkout -b slice/<NN-SS-LL>-<short-name>` from an
   up-to-date `main`.
4. **Build.** Code + tests together. Behavior parity is checked against the
   legacy analysis and the Phase 6 transaction walkthroughs; catalog
   entries are designed out, not re-implemented.
5. **Gates.** Run every gate the playbook defines (build with warnings as
   errors, unit, integration, smoke). All green, or the slice is not done.
   On failure: fix within the slice, never skip/disable a test; if the
   failure is out of scope, stop and report.
6. **Docs.** New `DEV-LOG.md` entry at the top (status
   `ready-for-commit`); tick the slice in the arc file; strike through
   resolved catalog entries (`~~...~~ — resolved in slice NN-SS-LL`).
7. **Handoff.** Report: slice ID, branch, gate results with counts, files
   changed, catalog IDs resolved, and the review command
   (`git diff main...HEAD`). Stop.
8. **Iterate** on reviewer feedback on the same branch. After the merge,
   the reviewer (or implementer, if asked) flips the DEV-LOG status to
   `merged`.

At arc completion: arc DoD checked, tag `arc-NN-complete`, retrospective
entry in `DEV-LOG.md`, `arcs/README.md` status updated.

## Exit criteria (per slice)

- [ ] All gates green, counts reported
- [ ] DEV-LOG entry, arc checkbox, catalog strike-throughs done
- [ ] Diff handed to the reviewer; nothing pushed to `main` by the implementer
