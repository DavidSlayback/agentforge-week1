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
| 1 | AI scrape | **approved 2026-09-25** | `PROJECT-MAP.md`, `project/*.md`, `ui/DASHBOARD-MAP.md`, `api/*.md`, `REQUIREMENTS-TRACE.md`, `seed/` |
| 2 | UI-layer audit | **approved 2026-09-25** | `ui/README.md`, `ui/UI-FLOW.md`, `ui/DEMOGRAPHICS*.md` + 7 unit analyses |
| 3 | Module audit | **approved 2026-09-25** (client model B) | `modules/README.md`, `modules/DATA-FLOW.md` + 10 module analyses |
| 4 | Data audit | **approved 2026-09-25** | `data/README.md`, `data/SCHEMA.md`, `data/UUID-MAPPING.md`, `data/CONFIG.md` |
| 5 | Repo split | **approved 2026-09-25** (in place) | tag `legacy-baseline` → `3ccfe1d`, `AGENT-BRIEF.md`, `README.md` |
| 6 | Deep-dive | **approved 2026-09-25** (code-only; live evidence deferred to the build) | `VERIFICATION.md`, `walkthroughs/*.md` (5) |
| 7 | Bug catalog | in progress: harvest (2 haiku) → dedup/severity (tier 3) | `BUGS-MITIGATIONS.md` |
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
- [x] T3 `interface/patient_file/summary/demographics.php`, split at the page ACL gate: lines 1–1055 → `ui/DEMOGRAPHICS-PART1-BOOT.md`, 1056–end → `ui/DEMOGRAPHICS-PART2-CARDS.md` (merged into `ui/DEMOGRAPHICS.md` by the orchestrator)
- [x] T2 `templates/patient/card/*` for Allergies, Medical Problems and Medications → `ui/CARD-TEMPLATES.md` (added 2026-09-25: missing from the Phase 1 queue)
- [x] T2 `interface/patient_file/summary/vitals_fragment.php` (+ the vitals report it renders) → `ui/VITALS-FRAGMENT.md` (DB-08 = Vitals)
- [x] T3 `src/Patient/Cards/CareTeamViewCard.php` + `templates/patient/card/manage_care_team.html.twig` → `ui/CARE-TEAM-CARD.md` (why seeded members didn't render)
- [x] T3 `interface/patient_file/summary/stats.php` → `ui/STATS.md`
- [x] T2 `interface/patient_file/summary/dashboard_header.php` + the tabbed-shell patient bar (`interface/main/tabs/`) → `ui/DASHBOARD-HEADER.md`
- [x] T2 `templates/prescription/general_fragment.html`, `general_list.html.twig` → `ui/PRESCRIPTION-TEMPLATES.md` (B-14)
- [x] T1 `src/Common/Layouts/LayoutsUtils.php` → `ui/LAYOUTS-UTILS.md`

**Phase 3: modules (auth first, then read paths)**
- [x] T3 `src/RestControllers/AuthorizationController.php` (1,772 lines) → `modules/AUTHORIZATION-CONTROLLER.md`
- [x] T3 (ovr) `src/RestControllers/Subscriber/CORSListener.php` → `modules/CORS-LISTENER.md` (verify: any Origin reflected?)
- [x] T3 `apis/routes/_rest_routes_standard.inc.php`, `_rest_routes_fhir_r4_us_core_3_1_0.inc.php` (in-scope routes only) → `modules/API-ROUTES.md`
- [x] T3 `src/Services/PatientService.php`, `src/Services/FHIR/FhirPatientService.php` → `modules/PATIENT-SERVICES.md`
- [x] T3 (ovr) `src/Services/AllergyIntoleranceService.php`, `FHIR/FhirAllergyIntoleranceService.php` → `modules/ALLERGY-SERVICES.md`
- [x] T3 (ovr) `src/Services/ConditionService.php`, `FHIR/FhirConditionService.php`, `src/Services/PatientIssuesService.php` → `modules/CONDITION-SERVICES.md` (`clinical-status` param)
- [x] T3 (ovr) `src/Services/PrescriptionService.php`, `FHIR/FhirMedicationRequestService.php`, `src/Services/ListService.php` → `modules/MEDICATION-SERVICES.md` (UNION, refills)
- [x] T3 `src/Services/CareTeamService.php`, `FHIR/FhirCareTeamService.php` → `modules/CARE-TEAM-SERVICES.md`
- [x] T2 `src/Services/FHIR/Observation/FhirObservationVitalsService.php`, `src/Services/FHIR/FhirObservationService.php` (routing and `_sort`) → `modules/VITALS-SERVICES.md`. (`pnotes` dropped from the queue: Messages isn't ported)
- [x] T3 `library/classes/Controller.class.php`, `library/lists.inc.php` → `modules/LEGACY-ROUTER-AND-LISTS.md`

**Phase 4: data**
- [x] T2 schema for `patient_data`, `lists`, `prescriptions`, `care_teams`, `care_team_member`, `pnotes`, `list_options` (relevant lists) → `data/SCHEMA.md`
- [x] T2 `uuid_registry` / pid↔uuid mapping → `data/UUID-MAPPING.md`

**Calibration (delegation.md):** the first tier-1 output (`WHATS-MISSING.md`) failed review; 8 rows were corrected. Judgment-heavy work goes to tier 2 or higher. Tier-2 claims were spot-checked (B-14 root cause, `filterActiveIssues`, the Rx UNION, missing `refills`, no pnotes GET) and held. **Correction (Phase 2):** the orchestrator's own Phase 1 check of the Rx `active` filter was wrong: it confirmed the template line exists, not that the filter fires. A tier-3 auditor showed it never fires. Lesson: verify that a gate *executes*, not that it's *written*.

## Decisions

| Date | Decision | Rationale |
|---|---|---|
| 2026-09-25 | Deceased test patient: pid 12 `deceased_date` = 2026-08-30 (`seed/phase1-seed-deceased.sql`, marker in `deceased_reason`) | Makes the header's derived "Deceased" status testable |
| 2026-09-25 | Phase 6 scope: **no scripted live API checks and no restricted-user checks**. Code-only walkthroughs now; live evidence comes from the build's walking skeleton, card by card. Findings stay "verified from code" until then | Scripted endpoint verification was stopped by a safety classifier; David chose options 1 + 3 |
| 2026-09-25 | Keep `rest_api` on in production | AgentForge's live adapter needs it; M-1 isn't reachable without a `prescription` scope, and no enabled client has one |
| 2026-09-25 | **Client model B**: the SPA is served by a thin BFF (our server, not OpenEMR's backend) holding a confidential OAuth client; tokens stay server-side; same-origin removes the CORS preflight problem; FHIR-first, standard REST per card where FHIR can't match (Allergies, Problems, Meds, Rx, Vitals) | Public clients can't get `user/` scopes (M-2); FHIR vitals serves deleted sets (M-5); preflight 404 (M-3) |
| 2026-09-25 | Phase 2 parity decisions (David, all as recommended): (1) Prescriptions shows **all** rows, with the dead `active` filter documented; (2) Vitals shows the **correct** latest set, an intentional deviation from the join bug; (3) Allergies: highlight severe only, no re-sort (sorting is a Phase 9 side quest); (4) empty lists always say "Nothing Recorded" (no `lists_touch` in the API); (5) squad restriction and `hide_dashboard_cards` accepted as API gaps, all cards shown; (6) live security checks with a restricted local test user approved for Phase 6 | Parity = what users see today, except where that is a patient-safety bug |
| 2026-09-25 | Vitals seed approved and applied (`seed/phase1-seed-vitals.sql`: 3 sets 2024–2026 plus 1 soft-deleted set on pid 13) | 'Latest of several' and deleted-row hiding must be testable |
| 2026-09-25 | Phase 1: DB-08 = **Vitals** (FHIR `Observation` vital-signs); Messages marked "not ported: no read API"; queue scope (29 units) and reduced tier-3 set approved; branch pushed, draft MR staging !81 | Patient notes was one of six brief options; `pnotes` has no read API by design (`ServerScopeListEntity.php:283`). Explicit requirements aren't blocked |
| 2026-09-25 | Phase 0 approved with the four recommendations: (1) seed synthetic Care Team + notes locally (done: `seed/phase1-seed.sql`, marker `[seed:phase1]`); (2) strict parity, improvements go to Phase 9; (3) audit docs on `agentforge/w2-dashboard`; (4) LF re-run, done from an LF copy inside the container (`git checkout-index`) so David's checkout is untouched | David: "approve, fan out to cheaper agents" |
| 2026-09-25 | Repo reconciliation (David): `week1-final` → `e4c0721` (Gauntlet snapshot Wbs…); GitLab staging is canonical and GitHub a one-way mirror (`origin/main` force-with-lease to `3ccfe1d`); GitLab staging is the tracker; merged, archived and dependabot branches deleted (`archive/*` tags keep superseded content) | One line, one tracker, a frozen Week 1 |
| 2026-09-25 | Probe patients: pid 13 (data-rich) and pid 3 (empty), from read-only SQL counts | pid 7 has no allergies; `phase0-setup.ps1` output wasn't available |
| 2026-09-25 | Audit docs committed to the working branch only, so they survive the ephemeral container; nothing is merged, and the slides stay git-excluded | David decides at the Phase 0 checkpoint whether they merge, stay on the branch, or move |

## Resume here (paused 2026-09-25 by David, travelling)

- **Paused deliberately (David, before travel):** the Phase 7 catalog writer (opus) was stopped after finishing its analysis, before writing; no partial file exists. **On resume, first continue that same agent** (write step only); re-run only if that fails. It was producing `BUGS-MITIGATIONS.md` from three harvest TSVs in the session scratchpad (`harvest-ui-project-baseline.tsv` 119 rows, `harvest-modules-data.tsv` 92, `harvest-router-data.tsv` 23), plus 4 hand-listed rows (BASELINE E-10; WHATS-MISSING OpenEMR input validation and secrets; AgentForge backups).
- **If `BUGS-MITIGATIONS.md` is missing or incomplete on resume:** re-run the harvest (2 haiku, mechanical, one TSV each, absolute output paths) and the tier-3 catalog step. The prompts follow the skill's Phase 7 procedure; check row counts against the ui/, modules/ and data/ README catalogs.
- **On resume:** check coverage (238 rows → entries), spot-check Critical/High entries, commit, present the Phase 7 checkpoint. Then Phase 8 starts by asking David for scoring dimensions and weights, before any scoring.
- **Local stack state:** seeds applied (pid 13 care team, notes and vitals; pid 12 deceased). The local OAuth client "Dashboard BFF (local Phase 6 verification)" is enabled. The admin token expired after 1 h; nothing depends on it. A `restricted` local user exists and is unused by agents; its password was pasted in chat, so David should rotate or delete it.

## Open questions

**Resolved: client model B (David, 2026-09-25).** SPA + thin BFF with a confidential OAuth client; FHIR-first, REST where FHIR can't match the card (`modules/README.md` per-card table). **M-1 production exposure (checked by David in the admin UI, 2026-09-25):** `rest_api=1`, FHIR and portal APIs off. The only enabled API client (AgentForge live adapter) has `openid offline_access api:oemr user/{patient,encounter,medical_problem,allergy,medication,document}.rs` and **no `prescription` scope**. The route scope is `user/prescription.*` (`AuthorizationListener.php:186-192`), so M-1 is **not reachable in production** through it. Rules: don't grant `user/prescription.*` to any client until M-1 is fixed; the BFF (which needs it) sends only allow-listed query keys. Upstream report: **deferred** (David, 2026-09-25: "we'll think about it later"); nothing to be sent. Follow-up: protect AgentForge's refresh-token cache (M-4 makes a refresh token sufficient to mint tokens).

**Phase 6 verification list** (security findings from Phase 2, confirmed by reading code, not exercised live; live checks need a restricted test user, which needs David's approval):
- U-4 Care Team save without write ACL · U-6/U-7 pre-authorization patient switch and identity JS · U-8 fragment endpoints without ACL (vitals, stats immunizations, labdata, reminders) · Rx edit list under view-only ACL · `pnotes_fragment.php` `disappearPnote` before ACL · eRx SOAP POSTs without CSRF · U-5 Care Team stored XSS
- Phase 3 additions: M-1 authenticated SQL injection on `/api/prescription` (**do not exercise; David decides on upstream report; check `rest_api` on the public deploy**) · M-4 confidential client not authenticated at `/token` without a secret · M-9 seven `controller.php` controllers with no ACL · auth codes reusable within TTL · logout open redirect / unsigned `id_token_hint` · API error bodies leak SQL · `api_log` stores full response bodies

**Phase 2 parity questions:** see the Phase 2 checkpoint (Rx all-vs-active, Vitals deleted set, allergy severity ordering, empty-state wording without `lists_touch`, inactive Care Team members, squad restriction, `hide_dashboard_cards`).

- [x] Requirements document: received 2026-09-25 (W2 surprise challenge)
- [x] Ambiguities A1–A6: all agreed. DB-08 was Patient Notes, changed to **Vitals** at the Phase 1 checkpoint (no read API for `pnotes`)
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

- 2026-09-25 — Phase 1 approved; DB-08 → Vitals; vitals seed applied. Phase 2: 9 auditors (2 opus, 6 sonnet, 1 haiku); tier-3 verification of U-1…U-11. Phase 1 corrections applied (Rx filter, Details column, collapse default, Care Team render, Messages `Done` notes, line count). Phase 2 checkpoint presented.

- 2026-09-25 — Phase 2 approved (6 parity decisions). Phase 3: 9 auditors (3 opus, 6 sonnet) plus a scoped opus re-run of medication services (the first attempt's write was stopped by a safety classifier). Verified: public-client scope restriction (port blocker), CORS preflight 404 (confirmed live with one unauthenticated OPTIONS request), SQL injection on `/api/prescription` (not exercised), FHIR vitals deleted-set exposure, CareTeam member status gap. Escalated SQLi and the A/B client-model decision to David.

- 2026-09-25 — Phase 3 approved (client model B). M-1 production exposure checked by David: not reachable (no enabled client has a prescription scope); `rest_api` stays on; upstream report deferred. Phase 4: 2 sonnet auditors (schema, uuid mapping and config). Tier-3 corrections: `outcome=6` exists with a blank title; `ListService` uuid null-guard downgraded to Medium. Phase 4 checkpoint presented.

- 2026-09-25 — Phase 4 approved. Phase 5 in place: annotated tag `legacy-baseline` → `3ccfe1d` pushed to staging and origin (David: yes); `AGENT-BRIEF.md` and `README.md` written; pointer added to `AGENTS.md`. Phase 5 checkpoint presented.

- 2026-09-25 — Phase 5 approved. Phase 6: local confidential OAuth client registered and enabled by David; admin token captured; smoke test OK (REST + FHIR 200; `api:oemr` present in token claims though missing from the token response's `scope` string; `/api/patient?pubpid=13` ignores the filter, returns all 13). Scripted verification stopped (safety classifier); switched to code-only walkthroughs.

- 2026-09-25 — Phase 6: 5 sonnet walkthroughs (sign-in + header, issue cards, prescriptions, care team, vitals). `VERIFICATION.md` compiled: 20 High/Critical-candidate claims, 4 observed live (M-3 preflight, B-14, M-2 consistency, dead REST filters). Resolved: BFF allow-lists `patient_id` for `/api/prescription`; vitals via REST per encounter carries units. Phase 6 checkpoint presented.

- 2026-09-25 — Phase 6 approved; deceased seed applied to pid 12. Phase 7 started: findings harvest (2 haiku, to scratchpad TSV) → tier-3 dedup and final severity.
