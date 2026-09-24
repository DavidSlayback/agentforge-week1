# Migration: <Route name — stack summary>

The single source of truth for **how** the rewrite happens. The **what**
lives in `BUGS-MITIGATIONS.md` (issues to design out), `DEV-LOG.md` (one
entry per slice), and `arcs/ARC-NN-NAME.md` (stories, slices, acceptance
criteria per arc). If a process rule changes mid-rewrite, edit this file and
reference the change in `DEV-LOG.md`.

## Contents

1. Purpose & scope
2. Target architecture
3. Solution & project structure
4. Tech stack & rationale
5. Coding standards
6. Test strategy
7. Required documentation artifacts
8. Git workflow
9. The slice loop
10. Epic / Story / Slice hierarchy
11. Roadmap: arcs
12. Templates
13. Definition of Done

## 1. Purpose & scope

- **In scope:** feature parity with `<legacy>` as documented in `ui/`,
  `modules/`, `data/`; resolution of every catalog entry mapped below.
- **Out of scope:** <business-process changes, multi-tenancy, infra beyond X, side quests>.

## 2. Target architecture

### Layer model

Strict one-way dependencies; anything below depends only on things above
it (or pure types).

```
┌──────────────────────────────┐
│ <Entry / composition root>   │ ← depends on all below
├──────────────────────────────┤
│ <Presentation>               │ ← Application, Domain
├──────────────────────────────┤
│ <Infrastructure>             │ ← Application, Domain
├──────────────────────────────┤
│ <Application (use cases)>    │ ← Domain only
├──────────────────────────────┤
│ <Domain>                     │ ← nothing
└──────────────────────────────┘
```

### How the catalog's architectural smells are designed out

| Catalog ID | Legacy smell | Design decision |
|---|---|---|
| 8.01 | <global SQL buffer> | <parameterized repositories; no shared mutable query state> |

### Modular design within a layer

<One folder per domain area per layer, so a feature touches one folder per layer.>

## 3. Solution & project structure

```
<repo>/
├── ORIGINAL-CODE/   (frozen; never edit)
├── docs/
├── src/
├── tests/
└── tools/
```

## 4. Tech stack & rationale

| Concern | Choice | Why | Replaces |
|---|---|---|---|

## 5. Coding standards

- <language level, nullability, immutability, DI, logging, error handling>

## 6. Test strategy

1. **Unit** — <scope>
2. **Integration** — <real DB, real file system>
3. **Smoke** — <app boots, key flows>
4. **Regression / characterization** — the Phase 6 transaction walkthroughs
   as executable acceptance tests.

### Test gates per slice

```bash
<build with warnings as errors>
<unit + integration>
<smoke>
```

All must be green before handoff.

## 7. Required documentation artifacts

- `DEV-LOG.md` — append-only, newest first, one entry per slice.
- `arcs/ARC-NN-NAME.md` — written before the arc's first slice.
- `BUGS-MITIGATIONS.md` — kept current; strike through resolved entries with the slice ID.

## 8. Git workflow

- Branches: `slice/<NN-SS-LL>-<short-name>` off `main`.
- Commits: Conventional Commits (`feat(booking): ...`).
- `main` protected: linear history, squash-merge only, all gates green.
- Tags: `arc-NN-complete`, `vX.Y.Z`.

## 9. The slice loop

Roles: **Implementer** (LLM agent or developer) creates the branch, writes
code + tests + docs, runs gates, presents the diff. **Reviewer** (user)
reviews, commits, merges. The implementer never commits to `main`.

1. Slice selected → read this file, the arc file, last 3–5 DEV-LOG entries, referenced catalog IDs.
2. Branch created from up-to-date `main`.
3. Work performed (code + tests + docs).
4. Gates run — all green.
5. Docs updated (DEV-LOG entry `ready-for-commit`, arc checkbox, catalog strike-through).
6. Handoff: slice ID, branch, gate counts, files changed, `git diff main...HEAD`.
7. Reviewer reviews; implementer iterates on the same branch.
8. Reviewer squash-merges; DEV-LOG status → `merged`.

## 10. Epic / Story / Slice hierarchy

- Arc (epic) → Story (capability) → Slice (1–3 days, ≤ ~500 lines meaningful diff).

## 11. Roadmap: arcs

| # | Arc | Focus | Catalog IDs resolved |
|---|---|---|---|
| 01 | Foundation | skeleton, DI, test infrastructure, CI | |
| 02 | Data Layer | new DB, schema, repositories | |
| 03 | Auth & Sessions | modern hashing, login, session lifecycle | |
| 04 | Domain Core | aggregates, invariants, audit events | |
| 05 | Reports | new report engine, rebuild each report | |
| 06 | Presentation Foundation | shell, navigation, chrome | |
| 07+ | <Feature UI arcs, one per cluster in `ui/README.md`> | | |
| .. | Cross-cutting | logging, watchdogs, audit tables | |
| .. | Data Migration Tooling | legacy DB → new DB importer | |
| .. | Polish & Hardening | accessibility, performance, packaging | |
| .. | Release | installer/deploy, signing, cutover | |

Every catalog entry appears in exactly one arc, or in this list:
**Won't carry forward:** <IDs + reason>.

## 12. Templates

- Arc file: `templates/ARC.md` in the legacy-conversion skill.
- DEV-LOG entry: see `DEV-LOG.md` header.
- Slice plan:
  ```markdown
  ## Slice NN-SS-LL — <title>
  Intent: ...
  Files: ...
  Tests: ...
  Catalog IDs: ...
  Acceptance: ...
  ```

## 13. Definition of Done

- **Slice:** gates green; DEV-LOG entry; arc checkbox; catalog updated; reviewed and merged.
- **Story:** all slices done; acceptance criteria demonstrated.
- **Arc:** all stories done; arc DoD checklist; tag; retro entry.
- **Project:** parity checklist vs `ui/README.md`; all non-won't-carry catalog entries resolved; data migration rehearsed; release artifacts signed.
