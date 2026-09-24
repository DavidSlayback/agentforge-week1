# Phase 5 — Repo Split (frozen source + docs)

**Goal:** a working repository where the legacy source is an immutable
reference and the audit docs are first-class, versioned artifacts — the
home for everything that follows, including the rewrite.

**Artifacts:** a repo (or directory) with this shape, plus a `CLAUDE.md`
(from `templates/CLAUDE-AUDIT.md`) and `README.md`:

```
<project>-rework/
├── ORIGINAL-CODE/<upstream-name>/   frozen upstream source — never edited
├── docs/
│   ├── AUDIT-STATE.md
│   ├── RECON.md  INVENTORY.md  PROJECT-MAP.md
│   ├── project/  ui/  modules/  data/
│   ├── BUGS-MITIGATIONS.md          (Phase 7)
│   ├── MIGRATION-OPTIONS.md         (Phase 8)
│   ├── MIGRATION-<ROUTE>.md         (Phase 8)
│   ├── arcs/  DEV-LOG.md            (Phase 8/10)
├── sidequests/                      (Phase 9)
├── CLAUDE.md
└── README.md
```

When the rewrite starts, `src/`, `tests/`, and `tools/` appear at the root
per the chosen playbook.

## Procedure

1. **Freeze the source.** Copy the upstream tree unmodified into
   `ORIGINAL-CODE/<name>/` in one commit ("import upstream at <ref>"),
   recording the upstream URL, commit/tag, and license in `README.md`. If the
   legacy code lives in the *same* repo you will rewrite in (e.g. an
   in-place modernization), pin a tag instead (`legacy-baseline`) and treat
   the audited paths as read-only for the audit's duration.
2. **Move the docs** produced so far under `docs/` with their layer folders.
   Keep diagram `.svg`/`.png` files in each section's `assets/` folder,
   paired with a `.md` companion.
3. **Write `CLAUDE.md`** from `templates/CLAUDE-AUDIT.md`. It must carry:
   repo purpose, "do not edit `ORIGINAL-CODE/`", how to build/run the
   original (even if only on a legacy OS), the doc-tree layout, the doc
   voice rules, and the **load-bearing architecture facts** distilled from
   Phases 1–4 (entry point, navigation shape, defining architectural choice,
   data access pattern, globals, security model, reporting, logging). This
   is what makes Phase 6 cheap: every new session starts briefed.
4. **Write `README.md`**: what this is, phase status table, documentation
   index, reading order for newcomers, license split (upstream vs. new work).
5. **Commit docs with focused messages**, one per doc or per layer
   (`docs(ui): document login form`).

## Exit criteria

- [ ] Legacy source frozen with provenance (URL, ref, license) recorded
- [ ] All Phase 0–4 artifacts live under `docs/` in the layer layout
- [ ] `CLAUDE.md` contains the load-bearing architecture summary
- [ ] `README.md` has status table, doc index, and reading order
