# Phase 0 — Manual Recon ("Meet the Patient")

**Goal:** know what the application *does* before reading a line of its
source. If you don't know the behavior, the LLM summarizes syntax instead of
behavior. 15–30 minutes of looking pays for itself across the whole audit.

**Artifact:** `RECON.md` (from `templates/RECON.md`), plus
`INVENTORY.md` (script output).

## Procedure

1. **Read what the humans left behind.** README, CHANGELOG, LICENSE, install
   notes, wiki exports, comments at the top of the entry file. Record:
   author/vendor, years active, license, last-touched date, whether a
   maintainer exists.
2. **Run the deterministic inventory** — no judgment, just counts:
   ```bash
   python3 .claude/skills/legacy-conversion/scripts/inventory.py <source-root> --churn > <docs-root>/INVENTORY.md
   ```
   It reports lines by extension and directory, largest files, detected
   build manifests, shipped binaries/artifacts, and (with `--churn`) git
   history hot spots.
3. **Run the application** (or have the user run it and describe/screenshot
   it — ask if you cannot run it yourself). Click every top-level screen.
   Log in with whatever credentials the app suggests. Note:
   - what the login/first screen reveals (default credentials, versions,
     demo banners, license nags);
   - the **center of gravity** — the one screen/endpoint everything else
     hangs off (StarHotel: the room-button grid). Name it now; it tells you
     where to aim the audit;
   - navigation primitives (menus, hotkeys, routes), roles/permissions you
     can see, reports/exports it produces;
   - what ships in the publish/dist folder (executables, runtimes, data
     files, report templates) and its platform constraints (32-bit, OS
     version, runtime EOL dates).
4. **Eyeball the tree.** Top two levels only. Identify the project manifest
   (see `reference/glossary.md` for per-stack names) — it is your index
   into the codebase for Phase 1.
5. **Write `RECON.md`.** Facts only, each one something you *observed*. No
   source-code citations yet — that is the point of this phase. Include a
   "Vital signs" stat block (lines, UI units, modules, tables, reports,
   external deps) from the inventory.
6. **If the app cannot be run** (missing runtime, license dongle, no DB),
   record that as a finding in `RECON.md` §Constraints and substitute
   screenshots, manuals, or user interviews. Do not skip the phase.

## Exit criteria

- [ ] `INVENTORY.md` generated from the frozen source root
- [ ] `RECON.md` written: purpose, users, platform, vital signs, center of gravity
- [ ] Project manifest identified and named in `RECON.md`
- [ ] At least one run-through (or documented substitute) recorded
- [ ] Obvious red flags from the outside listed (credentials on screen, EOL runtimes, hardcoded locale/currency, etc.)
- [ ] `AUDIT-STATE.md` updated; scoping notes captured (anything to exclude, e.g. vendored libs)
