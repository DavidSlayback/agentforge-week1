# Audit State — AgentForge (OpenEMR + AgentForge service)

Single source of truth for where this conversion stands. Any session (human
or LLM) resumes from this file. Update it at the end of every working turn.

| Field | Value |
|---|---|
| Legacy source root (read-only) | repo root, in place (`DavidSlayback/agentforge-week1`, `main` @ `10724d0`) |
| Upstream / provenance | `Gauntlet-HQ/openemr-base-clean` @ `ef3d4909`, OpenEMR license (GPL-3) |
| Docs root | `docs/legacy-audit/` on working branch `claude/legacy-codebase-conversion-oc0jjg` (not merged; where these docs finally live is David's call). `TIERS.csv` is regenerated, not committed. |
| App runnable locally? | Yes, on David's laptop (Docker Desktop, `docker/development-easy-light`). No Docker daemon in the cloud container. |
| Unit of analysis | _(Phase 1: per feature/directory, per-file for security-critical code; see `references/scaling.md`)_ |
| Exclusions | `vendor`, `node_modules`, `Documentation`, `.phpstan`, `contrib`, `public`, `output`, `.scratch`, `fpdf`, generated FHIR R4 classes, `*.sql` data dumps, `*.svg`, `*.dot`, `*.html` docs |
| Current phase | 0 — Manual recon |
| Checkpoint mode | every phase (default) |
| Requirements source | W2 surprise challenge, *Modernize the Patient Dashboard* (`output/pdf/W2-surprise-challenge-modernize-patient-dashboard.pdf`, git-excluded). Intake is in `REQUIREMENTS-TRACE.md` (DB-01…DB-11). |
| Baseline checks | `node --test` (agentforge, evals), `run-w2-gate.mjs`; PHP checks pending `composer install` |
| Chosen route | _(Phase 8)_ |

## Phase status

| # | Phase | Status | Artifact(s) |
|---|---|---|---|
| 0 | Manual recon | in progress: waiting on David's run-through (focused on the patient dashboard) and answers to A1–A6 | `DISCOVERY-GUIDE.md`, `INVENTORY.md`, `TIERS.csv`, `BASELINE-ERRORS.md` (partial), `REQUIREMENTS-TRACE.md` (intake) |
| 1 | AI scrape | not started | |
| 2 | UI-layer audit | not started | |
| 3 | Module audit | not started | |
| 4 | Data audit | not started | |
| 5 | Repo split | not started (in place: `legacy-baseline` tag, to confirm) | |
| 6 | Deep-dive | not started | |
| 7 | Bug catalog | not started | |
| 8 | Migration route | not started | |
| 9 | Side quests | not started | |
| 10 | Vertical slices | not started | |

## Current phase exit criteria (Phase 0)

- [x] `DISCOVERY-GUIDE.md` written with this repo's run instructions
- [ ] David's answers to the discovery guide received. General pass done (B-01…B-05); dashboard pass pending a data-rich synthetic patient
- [x] `INVENTORY.md` generated (with exclusions above). Regenerate `TIERS.csv` with the command in `INVENTORY.md`'s header notes.
- [ ] `BASELINE-ERRORS.md` complete. Node checks done; PHP checks (isolated PHPUnit, PHPCS, PHPStan) wait on `composer install`; runtime errors come from David's run-through
- [ ] `RECON.md` written from David's run-through plus the inventory (started; dashboard section pending)
- [ ] Project manifest identified in `RECON.md` (`composer.json` plus `package.json`; the OpenEMR entry point is `interface/`)
- [ ] Red flags listed
- [ ] Checkpoint presented and approved

## Decisions

| Date | Decision | Rationale |
|---|---|---|
| 2026-09-25 | Audit docs committed to the working branch only, so they survive the ephemeral container; nothing is merged, and the slides stay git-excluded | David decides at the Phase 0 checkpoint whether they merge, stay on the branch, or move |

## Open questions

- [x] Requirements document: received 2026-09-25 (W2 surprise challenge)
- [x] Ambiguities A1–A6: all agreed; DB-08 = Patient Notes (David, 2026-09-25)
- [ ] Should audit docs be committed to this repo, kept local, or live elsewhere?

## Workflow test notes (feedback for the skill)

- The inventory counted 3.4M lines by default because it included documentation, SQL data dumps, the PHPStan baseline, generated FHIR classes, and vendored JS under `Documentation/`. After exclusions it counts 1.0M lines. The skill should suggest standard exclusions (docs, generated code, data dumps, analyzer baselines) up front.
- Tier scoring uses absolute match counts, so any very large file counts as "dense security code" (for example a 250K-line translation SQL dump). Density should be relative to file size.
- Tier scoring also scores non-code files (CSS, YAML, XML fixtures). It should tier code extensions only.

## Phase log

- 2026-09-25 — Phase 0 started. Inventory and tiers generated. AgentForge service tests 103/103 and evals tests 10/10 pass, and the W2 eval gate passes. `composer install` running for the PHP checks.
- 2026-09-25 — Requirements received (W2 surprise challenge: port the patient dashboard to a modern framework on the REST/FHIR API). Intake written to `REQUIREMENTS-TRACE.md` with 11 requirements and 6 ambiguities. Discovery guide refocused on the patient dashboard.
- 2026-09-25 — David's general run-through: 5 observations logged (B-01…B-05). Scope limited to the brief's cards plus Patient Notes; A1–A6 agreed. Next: David generates synthetic patients (`import-random-patients`) and probes the dashboard.
