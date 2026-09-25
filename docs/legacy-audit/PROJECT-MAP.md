# Project Map — AgentForge (OpenEMR fork), scoped to the patient dashboard port

A tree, not a critique. Synthesized by tier 3 (Opus) from nine Phase 1 maps
(six tier-2, two tier-1 plus the tier-3 review), at `3ccfe1d`, 2026-09-25.
Every row links to the detailed map it came from.

| Detailed map | Covers | Audited by |
|---|---|---|
| [`project/COMPOSER-JSON.md`](project/COMPOSER-JSON.md) | PHP manifest, 109 dependencies | tier 2 |
| [`project/PACKAGE-JSON.md`](project/PACKAGE-JSON.md) | JS manifests, asset pipeline | tier 2 |
| [`project/DOCKER-DEV-STACK.md`](project/DOCKER-DEV-STACK.md) | local stack, devtools | tier 2 |
| [`project/CI-AND-HOOKS.md`](project/CI-AND-HOOKS.md) | gates: what runs, what's enforced | tier 2 |
| [`project/DEPLOY-VULTR.md`](project/DEPLOY-VULTR.md) | deployed topology, SHA reporting | tier 2 |
| [`project/SOURCE-TREE.md`](project/SOURCE-TREE.md) | directories, layers, API route files | tier 1 |
| [`project/WHATS-MISSING.md`](project/WHATS-MISSING.md) | absences, with evidence | tier 1, corrected by tier 3 |
| [`ui/DASHBOARD-MAP.md`](ui/DASHBOARD-MAP.md) | the dashboard page, card by card | tier 2, key claims verified by tier 3 |
| [`api/AUTH-AND-PATIENT.md`](api/AUTH-AND-PATIENT.md) | OAuth2/OIDC, CORS, `Patient` (DB-01, DB-02) | tier 2 |
| [`api/CLINICAL-CARDS.md`](api/CLINICAL-CARDS.md) | API sources for DB-03…DB-08 | tier 2, key claims verified by tier 3 |

## Entry point and boot sequence (dashboard)

1. Browser → `interface/main/tabs/main.php` (tabbed shell) → iframe
   `interface/patient_file/summary/demographics.php?set_pid=N`.
2. `interface/globals.php:725-728` includes `auth.inc.php` (session login).
3. `set_pid` → `setpid()` / `PatientService::findByPid()` (`demographics.php:83-94`).
4. Page ACL gate `AclMain::aclCheckCore('patients','demo')` exits on failure
   (`demographics.php:1056-1061`).
5. Cards render in hard-coded source order. Issue-type cards come from
   `stats.php` in `issue_types.ordering` order. Collapse state is a per-user
   setting (`getUserSetting()`).
6. Assets: `Header::setupHeader(['common','utility'])` (`demographics.php:384`)
   → `config/config.yaml` → `public/assets/`. Only jQuery and Bootstrap are
   confirmed as loaded by the dashboard.

API entry (for the port): `apis/dispatch.php` → `ApiApplication` → route
files `apis/routes/_rest_routes_standard.inc.php` (96 routes) and
`_rest_routes_fhir_r4_us_core_3_1_0.inc.php` (71 routes). OAuth2 goes through
`oauth2/` and `src/RestControllers/AuthorizationController.php`.

## Source tree by layer (tracked files)

```
agentforge-week1/                       9,097 tracked files
├── interface/ (1,879)  templates/ (243)  portal/ (198)      UI         → Phase 2
├── src/ (2,115)  library/ (617)  controllers/ (10)  apis/ (5)  oauth2/ (2)  custom/ (21)
│                                                            modules    → Phase 3
├── sql/ (45)  sites/ (43)  ccdaservice/ (97)  ccr/ (32)     data       → Phase 4
├── docker/ (227)  ci/ (47)  .github/ (76)  db/ (4)  config/ (9)  bin/ (6)  tools/ (19)  webpack/ (2)
│                                                            build      → done here
├── tests/ (750)                                             tests
├── agentforge/ (183)  evals/ (14)  observability/ (6)  deploy/ (7)   AgentForge (not in port scope)
├── gacl/ (139)  contrib/ (63)                               vendored   → excluded
└── docs/ (129)  swagger/ (19)  meta/ (2)                    docs
```

## UI units in scope (the dashboard)

| Unit | Path | Lines | Purpose | Opened from |
|---|---|---|---|---|
| Dashboard page | `interface/patient_file/summary/demographics.php` | 2,080 | 22-card patient dashboard | tabbed shell, Finder, `set_pid` URL |
| Header | `interface/patient_file/summary/dashboard_header.php` | 30 | title + nav row | `demographics.php` |
| Issue cards | `interface/patient_file/summary/stats.php` | 301 | issue-type cards (Health Concerns, Immunizations…) | `demographics.php` |
| Messages card | `interface/patient_file/summary/pnotes_fragment.php` | 122 | `pnotes`, N most recent active | `demographics.php` (AJAX) |
| Care Team card | `src/Patient/Cards/CareTeamViewCard.php` + `templates/patient/card/manage_care_team.html.twig` | 343 + ? | care team view/edit | `demographics.php:1252-1276` |
| Rx card / list | `templates/prescription/general_fragment.html`, `general_list.html.twig` | — | card (active only) / edit list (all) | `controller.php?prescription&list` |

The other 16 cards are listed in [`ui/DASHBOARD-MAP.md`](ui/DASHBOARD-MAP.md) and marked "not ported" (A1).

## Modules in scope (read paths for DB-01…DB-08)

| Module | Path | Lines | Purpose |
|---|---|---|---|
| Auth server | `src/RestControllers/AuthorizationController.php` | 1,772 | OAuth2/OIDC endpoints |
| CORS | `src/RestControllers/Subscriber/CORSListener.php` | 70 | cross-origin headers for API |
| Patient | `src/Services/PatientService.php`, `src/Services/FHIR/FhirPatientService.php` | 905, 976 | header data |
| Allergies | `src/Services/AllergyIntoleranceService.php`, `FHIR/FhirAllergyIntoleranceService.php` | 337, 241 | DB-03 |
| Problems | `src/Services/ConditionService.php`, `FHIR/FhirConditionService.php`, `PatientIssuesService.php` | 286, 134, 300 | DB-04 |
| Meds + Rx | `src/Services/PrescriptionService.php` (UNION of `prescriptions` + `lists` medication), `FHIR/FhirMedicationRequestService.php`, `ListService.php` | 437, 532, 207 | DB-05, DB-06 |
| Care team | `src/Services/CareTeamService.php`, `FHIR/FhirCareTeamService.php` | 620, 427 | DB-07 |
| Notes | `library/pnotes.inc.php`, `src/RestControllers/MessageRestController.php` (POST/PUT/DELETE only) | 543, 165 | DB-08 |
| Legacy router | `library/classes/Controller.class.php` | 273 | `controller.php` dispatch (B-14) |
| Card filter | `filterActiveIssues()` in `demographics.php:1110-1113`; `library/lists.inc.php` | — | the active-issue rule |

## Data assets in scope

| Asset | Path | Kind |
|---|---|---|
| `patient_data`, `lists`, `prescriptions`, `care_teams`, `care_team_member`, `pnotes`, `list_options` | `sql/database.sql` | schema |
| Upgrade scripts | `sql/*_upgrade.sql` | migrations |
| Phase 1 seed (local only) | `docs/legacy-audit/seed/phase1-seed.sql` / `phase1-unseed.sql` | seed |

## External dependencies (port-relevant; full lists in the manifests' maps)

| Dependency | Version | Used for | Status | Note |
|---|---|---|---|---|
| league/oauth2-server | locked (see COMPOSER-JSON) | OAuth2 server | supported | PKCE behavior inherited from it |
| steverhoades/oauth2-openid-connect-server | locked | OIDC | unknown | |
| twig/twig, Symfony HTTP stack, PSR-7 | locked | rendering, API kernel | supported | |
| laminas/laminas-config, laminas-loader, yubico/u2flib-server | locked | legacy Zend modules; U2F | **abandoned** (`composer.lock`) | not on the dashboard path |
| jQuery, Bootstrap 4 | locked | dashboard UI | supported (Bootstrap 4 EOL 2023-01-01, per upstream) | only confirmed dashboard assets |
| AngularJS 1.8 | locked | other OpenEMR screens | EOL 2021-12-31 | not loaded by the dashboard |
| react 15.1.0 (napa) | pinned | nothing found | unknown | zero usage found |

## What's missing (summary; evidence in `project/WHATS-MISSING.md`)

OpenEMR in this fork: **no CI that runs** (the enforced hook runs no OpenEMR
PHPUnit, PHPStan, PHPCS or ESLint); no monitoring; partial input validation,
accessibility, backups, secrets handling and architecture docs; correlation
IDs unverified. AgentForge: CI hook only, English only, no accessibility tests.

## Not in the manifest

- `react` 15.1.0 and seven other napa-fetched packages have no lockfile record;
  react has no usage (`project/PACKAGE-JSON.md`).
- Two declared Composer `repositories` (wkhtmltopdf-openemr, oe-module-cqm)
  aren't used by anything in `composer.lock` (`project/COMPOSER-JSON.md`).
- Root `npm test` is a no-op that always exits 1.
- `ccdaservice/` is a separate Node workspace, not part of the browser build.

## Build / packaging artifacts

| Artifact | Analysis |
|---|---|
| `composer.json` / `composer.lock` | `project/COMPOSER-JSON.md` |
| `package.json` ×3, `webpack.themes.js` | `project/PACKAGE-JSON.md` |
| `docker/development-easy-light/` | `project/DOCKER-DEV-STACK.md` |
| `.githooks/`, `.gitlab-ci.yml`, `.pre-commit-config.yaml`, `.github/` | `project/CI-AND-HOOKS.md` |
| `deploy/vultr/` | `project/DEPLOY-VULTR.md` |
