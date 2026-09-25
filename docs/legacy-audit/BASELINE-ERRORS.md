# Baseline Errors — AgentForge (OpenEMR + AgentForge service)

What the project's own tooling says is broken **before** any change. Every
later slice is measured against this list: a slice may remove entries, but
must not add new ones.

**Source revision:** `3ccfe1d` (`staging/main` = `origin/main` =
`agentforge/w2-final`) · **Date:** 2026-09-25

**Environments:**
- Node checks: the cloud container, at `10724d0`. AgentForge code is
  unchanged since then apart from docs.
- PHP checks: David's laptop stack (`agentforge-week1-openemr-1`, PHP
  8.5.6, `docker/development-easy-light`). The container bind-mounts a
  **CRLF** Windows checkout (`core.autocrlf=true`).

Each check was run twice, independently, by Codex and by Claude. The counts
agree. Details are in `probe/results/{codex,claude-laptop}/BASELINE.md`.

## Checks run

| Check | Command | Result | Notes |
|---|---|---|---|
| AgentForge service tests | `cd agentforge && node --test test/*.test.js` | 103/103 pass | cloud |
| Evals tests | `cd evals && node --test test/*.test.js` | 10/10 pass | cloud |
| W2 eval gate | `cd agentforge && node scripts/run-w2-gate.mjs` | pass, 0 critical failures | cloud |
| OpenEMR isolated PHPUnit | `docker exec <c> /root/devtools phpunit-isolated` | 3,474 tests: **24 F**, 3 W, 1 N, 4 skipped, 14 incomplete | **All 24 F are CRLF artifacts** (E-01, E-02). On an LF checkout this is expected to be 0 F. That's proven for the 10 spawner failures and inferred for the 14 Twig failures. |
| PHP parse (`php -l`) | `… php-parserror` | 0 errors | 1 deprecation (E-03) |
| PHPCS / PSR-12 | `… psr12-report` | 8 errors in 3 files | E-04 (real), E-05 (environment) |
| ESLint | `… lint-javascript-report` | 3 errors in 3 files | E-06, all in AgentForge JS |
| PHPStan level 10 | `… phpstan` | **401 errors** on the CRLF checkout; **274 on an LF copy**, 272 of them real | Real: 272, all in the AgentForge module (E-11). The other 129 on CRLF are line-ending artifacts (E-12, proven). The 2 LF-only errors are copy artifacts: `oe-module-dorn` references the ClaimRev module, which isn't in the git index |
| PHP / Apache log | `… php-log`, Apache `error.log` | E-07 new during the probes | older entries predate this audit |
| DB-backed suites (unit/services/api/e2e) | `openemr-cmd ut/st/at/et` | _not run_ | Held back until the probes were done (HANDOFF). `openemr-cmd` isn't installed on the Windows host. |
| Runtime errors | David's run-throughs plus 2 automated probes | B-01…B-16, E-08, E-09 | |

## Failures

| # | Check | Error (exact) | Location | Reproduces? | Severity guess | Catalog ID |
|---|---|---|---|---|---|---|
| B-01 | David | Unexplained pop-up asking for an email address | login | always; both probes confirm it is "OpenEMR Product Registration" | Low (UX) | _(Phase 7)_ |
| B-02 | David | Pages load slowly | app-wide | always; dashboard network-idle 3.3–5.2 s (probes) | Medium (perf) | |
| B-03 | David | No validation on many fields, e.g. SSN | data-entry forms | always | Medium (data quality) | |
| B-04 | David | Form-field highlighting is hard to work with | data-entry forms | always | Low (UX) | |
| B-05 | David | Many tab pop-ups; unclear how the parts authenticate | navigation / auth | always | Medium | |
| B-06 | David | Navigation reloads everything and is slow | tabbed shell | always | Medium (perf) | |
| B-07 | David | Navigation relies on browser Back; easy to leave the patient view by accident | tabbed shell | always | Medium (UX, patient context) | |
| B-08 | David | The dashboard is a wall of text: no graphs, search or filters | dashboard | always | Medium (UX) | |
| B-09 | David | Card order: Vitals near the bottom | dashboard | always | Low | |
| B-10 | David | Pop-ups appear with no clear trigger | app-wide | intermittent | Low | |
| B-11 | David | Patient names contain numbers | all patients | always | **Not a bug**: Synthea test data | n/a |
| B-12 | David | Never re-prompts for authentication | session | always | Medium (security, to check the session timeout) | |
| B-13 | David | Adding and removing entries needs no confirmation | dashboard cards | always | Medium (data safety) | |
| B-14 | David | "Missing or invalid 'controller' parameter" when adding a prescription | thrown at `library/classes/Controller.class.php:202` | David, once. **Root cause verified:** `templates/prescription/general_list.html.twig:449` builds `{{ CONTROLLER }}?prescription…`, and `CONTROLLER` is already `controller.php?` (`Controller.class.php:78`), so the URL is `controller.php??prescription&edit…` and the first key becomes `?prescription` | **High** (a core workflow is broken) | |
| B-15 | David | The add/edit interface is hard to use | edit forms | always | Low (UX) | |
| B-16 | David | Medications vs Prescriptions is confusing | dashboard | always | Low (UX; two tables, different filters) | |
| E-01 | PHPUnit | "Rendered output does not match fixture … line endings differ" ×14 | `tests/Tests/Isolated/Common/Twig/fixtures/render/*.html` | always on this checkout | **Environment, proven**: an LF copy (`git checkout-index` into the container) passes all 3,474 tests with 0 failures | n/a |
| E-02 | PHPUnit | `bin/console: line 11: syntax error: unexpected word (expecting "do")`, plus 9 related | `SymfonyBackgroundServiceSpawnerTest` | always on this checkout; the LF copy passes 19/19 | **Environment** (CRLF checkout) | n/a |
| E-03 | php -l | `PatientPortalService::getRequest(): Implicitly marking parameter $param as nullable is deprecated` | `src/Services/PatientPortalService.php:183` | always | Low (upstream) | |
| E-04 | PHPCS | `Use statements should be sorted alphabetically` ×2 | `oe-module-agentforge/public/index.php:7`, `…/tests/run.php:50` | always | Low (AgentForge) | |
| E-05 | PHPCS | header blank line; tabs for alignment ×5 | `sites/default/sqlconf.php:1,5` | always | **Environment**: `sites/` is a Docker volume written by the installer | n/a |
| E-06 | ESLint | `no-useless-escape`; `no-empty` ×2 | `agentforge/src/ui.js:109`, `agentforge/test/openemr-module-roundtrip.test.js:33`, `evals/lib/runner.js:7` | always | Low (AgentForge) | |
| E-07 | Apache log | `PHP Warning: Undefined array key "version"` | `src/RestControllers/FHIR/FhirMetaDataRestController.php:85` | every `GET /fhir/metadata` (16:13 and 16:24 UTC probe runs) | Low; **relevant**: the port will call this endpoint | |
| E-08 | Browser console | `TypeError: top.restoreSession is not a function` ×2 per load | dashboard opened by direct URL | every load (both probes) | Low (the page assumes the tabbed shell) | |
| E-09 | Browser console | `TypeError: Cannot read properties of undefined (reading 'setPatient')` ×1 per load | same | every load | Low | |
| E-11 | PHPStan | 272 level-10 errors (LF run), e.g. `offsetAccess.nonOffsetAccessible` ×111 and `argument.type` ×102 in `tests/run.php`, plus `openemr.forbiddenInstantiation`, `openemr.forbiddenCatchType`, `method.notFound` in `public/` | `interface/modules/custom_modules/oe-module-agentforge/**` (51 files added by this fork, not in the baseline) | always | Medium: this fork's own code breaks the repo's static-analysis rule, and no gate runs PHPStan | |
| E-12 | PHPStan | `Ignored error pattern … was not matched in reported errors` ×116; `binaryOp.invalid` ×12 and `assignOp.invalid` ×1 on multi-line SQL string literals | `Carecoordination/…/CarecoordinationController.php` ×113, `PostCalendar/pnadmin.php`, `portal/…/PatientReporter.php` (all unchanged from upstream) | always on the CRLF checkout | **Environment, proven**: the literals contain CR bytes on this disk. The LF-copy run shows 0 `ignore.unmatched` and no errors in these files | n/a |
| E-10 | PHPUnit | 3 warnings, 1 notice | `vendor/particle/validator` ×2, `vendor/league/oauth2-server/src/CryptKey.php:74`, `src/Cqm/Qdm/BaseTypes/AbstractType.php:23` | always | Low (vendor/upstream) | |

## Missing checks

- DB-backed PHPUnit suites (unit, services, api, e2e). These need
  `openemr-cmd`, or `docker exec … /root/devtools ut` etc., and write test
  data to the database. They're held back until Phase 0 is approved.
- `npm run test:js` (Jest) for OpenEMR's front end.
- ~~LF re-runs~~: done. Isolated PHPUnit has 0 failures (E-01 proven); PHPStan
  has 272 real errors, all in `oe-module-agentforge` (E-12 proven).
- ~~Parity data for Care Team and Patient Notes~~: seeded on pid 13
  (`seed/phase1-seed.sql`).

## Notes

- **Why the laptop needs `MSYS_NO_PATHCONV=1`.** Git Bash rewrites
  `/root/devtools` into `C:/Program Files/Git/root/devtools` in
  `docker exec`. The first attempt failed with exit 127 for exactly that
  reason.
- `composer install` failed in the cloud container (GitHub auth). That's a
  limit of the audit environment; the PHP checks ran on the laptop instead.
