# Phase 1 — AI Scrape (the high-level map)

**Goal:** a complete structural map of the codebase produced from the build
manifest and file tree — *a tree, not a critique*.

**Artifacts:** `PROJECT-MAP.md` (from `templates/PROJECT-MAP.md`) and one
analysis per build/packaging artifact under `project/` (e.g.
`project/PROJECT-VBP.md`, `project/PACKAGE-JSON.md`, `project/POM-XML.md`).

## Why the manifest first

The manifest is read before any source file because it:

- lists every compilation unit in the project (and, by omission, the dead
  files lying around the tree that are *not* built);
- pins external dependencies with versions (COM references, packages, JARs,
  native libs) — deprecated ones get caught on day one;
- declares the entry point — often unconventional (StarHotel starts from
  `Sub Main`, not a form);
- carries the version, product name, and build flags.

It scopes the audit before one line of analysis is written, and lets you
brief an LLM without re-deriving the file list every session.

## Procedure

1. **Brief the model with Phase 0 context.** Paste/attach `RECON.md` and
   `INVENTORY.md`. Use the "just right" prompt from `reference/prompts.md`
   §Phase 1:
   > Start with `<manifest>`. Identify the entry point, every UI unit, every
   > module, every external dependency. Produce a tree, not a critique.
2. **Walk the manifest line by line** and write `project/<MANIFEST>.md`:
   each directive, what it means, anything unusual. Repeat for other
   packaging artifacts (resource files, installers, app manifests,
   workspace files, Dockerfiles, CI configs).
3. **Build `PROJECT-MAP.md`:**
   - Entry point and boot sequence (as far as the manifest + file names
     reveal it).
   - **Layer mapping** — classify every unit into UI layer (Phase 2),
     business/data modules (Phase 3), data assets (Phase 4), build/packaging
     (done here), third-party/vendored (excluded). Record the mapping in
     `AUDIT-STATE.md`; it defines the Phase 2–4 work queues.
   - External dependency table: name, version, purpose, status
     (supported / deprecated / EOL + date), replacement candidates.
   - Files present in the tree but not in the manifest (dead or orphaned).
   - Size of each unit (from `INVENTORY.md`) so the work queue can be
     ordered and batched.
4. **Choose the unit of analysis** (per file vs per feature/directory) using
   `reference/scaling.md`, and write the work queues into `AUDIT-STATE.md`
   as checklists — one line per unit, with its target analysis file name.
5. **Order the queues:** center of gravity first, then auth/session, then
   the highest-traffic transactional units, then admin/maintenance, then
   leaf utilities. Things to read last: generated code, designer
   boilerplate, vendored libraries.

## Anti-patterns

- Asking for bugs or a rewrite here (the "too eager" prompt). The model will
  guess, hallucinate, and jump to fixes for problems nobody has found yet.
- Summaries without file names. Every node in the tree is a real path.

## Exit criteria

- [ ] Every build/packaging artifact has a `project/*.md` analysis
- [ ] `PROJECT-MAP.md` lists entry point, all UI units, all modules, all data assets, all external deps with status
- [ ] Unit of analysis chosen and justified in `AUDIT-STATE.md`
- [ ] Phase 2, 3, 4 work queues written in `AUDIT-STATE.md`, ordered
- [ ] Orphaned/unbuilt files listed
