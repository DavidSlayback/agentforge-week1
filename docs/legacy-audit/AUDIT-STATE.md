# Audit State — AgentForge (OpenEMR + AgentForge service)

Single source of truth for where this conversion stands. Any session (human
or LLM) resumes from this file. Update it at the end of every working turn.

| Field | Value |
|---|---|
| Legacy source root (read-only) | repo root, in place (`main` @ `3ccfe1d` on both GitLab staging and GitHub; Week 1 frozen at tag `week1-final` = `e4c0721`) |
| Upstream / provenance | `Gauntlet-HQ/openemr-base-clean` @ `ef3d4909`, OpenEMR license (GPL-3) |
| Docs root | `docs/legacy-audit/` on branch `agentforge/w2-dashboard` (worktree `../agentforge-week1-w2-dashboard`, off `main` @ `3ccfe1d`; David, Phase 0 checkpoint). `TIERS.csv` is regenerated, not committed. |
| App runnable locally? | Yes, on David's laptop (Docker Desktop, `docker/development-easy-light`, container `agentforge-week1-openemr-1`). Agents can't type credentials, so hand exploration needs David to log in. |
| Unit of analysis | **Requirements-scoped** (`references/scaling.md`): ~1.0M lines puts the codebase in the subsystem band, but only the DB-01…DB-08 read paths get file-by-file audits (29 units below); everything else stays at Phase 1 map depth. |
| Exclusions | `vendor`, `node_modules`, `Documentation`, `.phpstan`, `contrib`, `public`, `output`, `.scratch`, `fpdf`, generated FHIR R4 classes, `*.sql` data dumps, `*.svg`, `*.dot`, `*.html` docs |
| Current phase | 0 — Manual recon |
| Checkpoint mode | every phase (default) |
| Requirements source | W2 surprise challenge, *Modernize the Patient Dashboard* (`output/pdf/W2-surprise-challenge-modernize-patient-dashboard.pdf`, git-excluded). Intake is in `REQUIREMENTS-TRACE.md` (DB-01…DB-11). |
| Baseline checks | Node: all pass. PHP (laptop): isolated PHPUnit 24 F (all CRLF artifacts), PHPCS 8, ESLint 3, PHPStan 401 (~273 in the AgentForge module). See `BASELINE-ERRORS.md`. |
| Chosen route | _(Phase 8)_ |

## Phase status

| # | Phase | Status | Artifact(s) |
|---|---|---|---|
| 0 | Manual recon | **approved 2026-09-25** | `DISCOVERY-GUIDE.md`, `INVENTORY.md`, `BASELINE-ERRORS.md`, `RECON.md`, `probe/results/` |
| 1 | AI scrape | **checkpoint presented 2026-09-25** | `PROJECT-MAP.md`, `project/*.md`, `ui/DASHBOARD-MAP.md`, `api/*.md`, `REQUIREMENTS-TRACE.md` (Today column), `seed/` |
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
- [x] David's answers received: general pass (B-01…B-05) plus a dashboard pass on pid 13 (B-06…B-16)
- [x] `INVENTORY.md` generated (with exclusions above). Regenerate `TIERS.csv` with the command in `INVENTORY.md`'s header notes.
- [x] `BASELINE-ERRORS.md` complete for non-DB checks (DB-backed suites held back on purpose; listed under Missing checks)
- [x] `RECON.md` written: David plus the Codex and Claude probes merged, with a disagreement table
- [x] Project manifest identified in `RECON.md` (`composer.json` plus `package.json`; the OpenEMR entry point is `interface/`)
- [x] Red flags listed
- [ ] Checkpoint presented and approved

## Work queues (Phases 2–4), ordered

Tier = model class per `references/delegation.md` (1 haiku, 2 sonnet, 3 opus). **Approved tiering (David, 2026-09-25): tier 3 only for `demographics.php`, `AuthorizationController.php`, `CORSListener.php` and `PrescriptionService.php`. Every other T3/"ovr" line below runs on tier 2 (sonnet), with a tier-3 spot-check of its claims.** Output goes to `ui/`, `modules/` or `data/` as `<NAME>.md`.

**Phase 2: UI layer**
- [ ] T3 `interface/patient_file/summary/demographics.php` (1,890 lines; split by section across agents) → `ui/DEMOGRAPHICS.md`
- [ ] T2 `interface/patient_file/summary/vitals_fragment.php` (+ the vitals report it renders) → `ui/VITALS-FRAGMENT.md` (DB-08 = Vitals)
- [ ] T3 `src/Patient/Cards/CareTeamViewCard.php` + `templates/patient/card/manage_care_team.html.twig` → `ui/CARE-TEAM-CARD.md` (why seeded members didn't render)
- [ ] T3 `interface/patient_file/summary/stats.php` → `ui/STATS.md`
- [ ] T3 (ovr) `interface/patient_file/summary/dashboard_header.php` → `ui/DASHBOARD-HEADER.md`
- [ ] T2 `templates/prescription/general_fragment.html`, `general_list.html.twig` → `ui/PRESCRIPTION-TEMPLATES.md` (B-14)
- [ ] T1 `src/Common/Layouts/LayoutsUtils.php` → `ui/LAYOUTS-UTILS.md`

**Phase 3: modules (auth first, then read paths)**
- [ ] T3 `src/RestControllers/AuthorizationController.php` (1,772 lines) → `modules/AUTHORIZATION-CONTROLLER.md`
- [ ] T3 (ovr) `src/RestControllers/Subscriber/CORSListener.php` → `modules/CORS-LISTENER.md` (verify: any Origin reflected?)
- [ ] T3 `apis/routes/_rest_routes_standard.inc.php`, `_rest_routes_fhir_r4_us_core_3_1_0.inc.php` (in-scope routes only) → `modules/API-ROUTES.md`
- [ ] T3 `src/Services/PatientService.php`, `src/Services/FHIR/FhirPatientService.php` → `modules/PATIENT-SERVICES.md`
- [ ] T3 (ovr) `src/Services/AllergyIntoleranceService.php`, `FHIR/FhirAllergyIntoleranceService.php` → `modules/ALLERGY-SERVICES.md`
- [ ] T3 (ovr) `src/Services/ConditionService.php`, `FHIR/FhirConditionService.php`, `src/Services/PatientIssuesService.php` → `modules/CONDITION-SERVICES.md` (`clinical-status` param)
- [ ] T3 (ovr) `src/Services/PrescriptionService.php`, `FHIR/FhirMedicationRequestService.php`, `src/Services/ListService.php` → `modules/MEDICATION-SERVICES.md` (UNION, refills)
- [ ] T3 `src/Services/CareTeamService.php`, `FHIR/FhirCareTeamService.php` → `modules/CARE-TEAM-SERVICES.md`
- [ ] T2 `src/Services/FHIR/Observation/FhirObservationVitalsService.php`, `src/Services/FHIR/FhirObservationService.php` (routing and `_sort`) → `modules/VITALS-SERVICES.md`. (`pnotes` dropped from the queue: Messages isn't ported)
- [ ] T3 `library/classes/Controller.class.php`, `library/lists.inc.php` → `modules/LEGACY-ROUTER-AND-LISTS.md`

**Phase 4: data**
- [ ] T2 schema for `patient_data`, `lists`, `prescriptions`, `care_teams`, `care_team_member`, `pnotes`, `list_options` (relevant lists) → `data/SCHEMA.md`
- [ ] T2 `uuid_registry` / pid↔uuid mapping → `data/UUID-MAPPING.md`

**Calibration (delegation.md):** the first tier-1 output (`WHATS-MISSING.md`) failed review; 8 rows were corrected. Judgment-heavy work goes to tier 2 or higher. Tier-2 claims were spot-checked (B-14 root cause, `filterActiveIssues`, the Rx `active` filter, the Rx UNION, missing `refills`, no pnotes GET) and all held.

## Decisions

| Date | Decision | Rationale |
|---|---|---|
| 2026-09-25 | Phase 1: DB-08 = **Vitals** (FHIR `Observation` vital-signs); Messages marked "not ported: no read API"; queue scope (29 units) and reduced tier-3 set approved; branch pushed, draft MR staging !81 | Patient notes was one of six brief options; `pnotes` has no read API by design (`ServerScopeListEntity.php:283`). Explicit requirements aren't blocked |
| 2026-09-25 | Phase 0 approved with the four recommendations: (1) seed synthetic Care Team + notes locally (done: `seed/phase1-seed.sql`, marker `[seed:phase1]`); (2) strict parity, improvements go to Phase 9; (3) audit docs on `agentforge/w2-dashboard`; (4) LF re-run, done from an LF copy inside the container (`git checkout-index`) so David's checkout is untouched | David: "approve, fan out to cheaper agents" |
| 2026-09-25 | Repo reconciliation (David): `week1-final` → `e4c0721` (Gauntlet snapshot Wbs…); GitLab staging is canonical and GitHub a one-way mirror (`origin/main` force-with-lease to `3ccfe1d`); GitLab staging is the tracker; merged, archived and dependabot branches deleted (`archive/*` tags keep superseded content) | One line, one tracker, a frozen Week 1 |
| 2026-09-25 | Probe patients: pid 13 (data-rich) and pid 3 (empty), from read-only SQL counts | pid 7 has no allergies; `phase0-setup.ps1` output wasn't available |
| 2026-09-25 | Audit docs committed to the working branch only, so they survive the ephemeral container; nothing is merged, and the slides stay git-excluded | David decides at the Phase 0 checkpoint whether they merge, stay on the branch, or move |

## Open questions

- [x] Requirements document: received 2026-09-25 (W2 surprise challenge)
- [x] Ambiguities A1–A6: all agreed; DB-08 = Patient Notes (David, 2026-09-25)
- [ ] Should audit docs be committed to this repo, kept local, or live elsewhere?

## Workflow test notes (feedback for the skill)

- The skill wasn't installed on the laptop (`~/.claude/skills/legacy-conversion` missing; the local `david-brain` checkout predates PRs #5 and #6, and its SSH fetch fails). The checkpoint template was read from GitHub instead.
- An agent can't log in to the app itself (it may not enter credentials), so "David explores, agents probe" works; scripted probes are the fallback.
- Windows laptops need `MSYS_NO_PATHCONV=1` for `docker exec … /root/devtools` from Git Bash, and a CRLF checkout breaks byte-exact tests and PHPStan baselines. The skill's baseline step should check line endings first.
- Parallel probers weren't fully independent: Claude read Codex's notes first, because David asked for them to be secured before worktree cleanup. Record reading order in each NOTES.md.

- The inventory counted 3.4M lines by default because it included documentation, SQL data dumps, the PHPStan baseline, generated FHIR classes, and vendored JS under `Documentation/`. After exclusions it counts 1.0M lines. The skill should suggest standard exclusions (docs, generated code, data dumps, analyzer baselines) up front.
- Tier scoring uses absolute match counts, so any very large file counts as "dense security code" (for example a 250K-line translation SQL dump). Density should be relative to file size.
- Tier scoring also scores non-code files (CSS, YAML, XML fixtures). It should tier code extensions only.

## Phase log

- 2026-09-25 — Phase 0 started. Inventory and tiers generated. AgentForge service tests 103/103 and evals tests 10/10 pass, and the W2 eval gate passes. `composer install` running for the PHP checks.
- 2026-09-25 — Requirements received (W2 surprise challenge: port the patient dashboard to a modern framework on the REST/FHIR API). Intake written to `REQUIREMENTS-TRACE.md` with 11 requirements and 6 ambiguities. Discovery guide refocused on the patient dashboard.
- 2026-09-25 — David's general run-through: 5 observations logged (B-01…B-05). Scope limited to the brief's cards plus Patient Notes; A1–A6 agreed. Next: David generates synthetic patients (`import-random-patients`) and probes the dashboard.
- 2026-09-25 — `composer install` failed in the cloud container (GitHub auth), so PHP checks move to the laptop. This session turned out to be a cloud session, not Remote Control on the laptop: the dashboard probe and PHP checks move to a laptop session (probe kit in `probe/`, handoff prompt given to David).
- 2026-09-25 — Laptop session (Claude, Local): repo reconciliation done as approved. Codex probe (pid 7) and claude-laptop probe (pids 13 and 3) run; PHP baseline complete (PHPStan 401). David's dashboard pass logged (B-06…B-16). Care Team and Patient Notes have no data and David couldn't create any. Phase 0 checkpoint presented.
- 2026-09-25 — Phase 0 approved. Phase 1: 8 parallel mappers (6 sonnet, 2 haiku) and a tier-3 review. Seed applied to pid 13. LF re-run: isolated PHPUnit 0 failures (E-01 proven). DB-08 has no read API (hard conflict with DB-10). Phase 1 checkpoint presented.

- 2026-09-25 — Phase 1 approved (scope, tiers, push; DB-08 → Vitals). Cross-checked against `PLAN.md` W2D-1…W2D-8 and the 09-24 pre-code parity spec (`.scratch/assignments/dashboard-parity-spec.md`, gitignored): same conclusions on header active status (derive from `deceasedDateTime`) and filters. **DB-xx ↔ W2D mapping:** DB-01=W2D-1, DB-02=W2D-2, DB-03…07=W2D-3, DB-08=W2D-4, DB-09=W2D-5, DB-10=W2D-8, DB-11=W2D-7. PLAN.md stays the single plan; this audit is its evidence.
