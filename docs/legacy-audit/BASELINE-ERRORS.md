# Baseline Errors — AgentForge (OpenEMR + AgentForge service)

What the project's own tooling says is broken **before** any change. Every
later slice is measured against this list: a slice may remove entries, but
must not add new ones.

**Source revision:** `main` @ `10724d0` · **Date:** 2026-09-25
**Environment:** cloud container. PHP 8.4.19 CLI, Composer, and Node are
available; the Docker daemon is not, so DB-backed OpenEMR suites and the
runtime click-through run on David's laptop.

## Checks run

| Check | Command | Result | Notes |
|---|---|---|---|
| AgentForge service tests | `cd agentforge && node --test test/*.test.js` | 103/103 pass | |
| Evals tests | `cd evals && node --test test/*.test.js` | 10/10 pass | |
| W2 eval gate | `cd agentforge && node scripts/run-w2-gate.mjs` | pass, 0 critical failures | |
| OpenEMR isolated PHPUnit | `composer phpunit-isolated` or `openemr-cmd pit` | _not run_ | `composer install` failed in the cloud container (see Notes). Run on the laptop stack. |
| PHP style | `composer phpcs` or `openemr-cmd pr` | _not run_ | same as above |
| PHPStan level 10 | `composer phpstan` or `openemr-cmd pst` | _not run_ | same as above; full codebase |
| JS lint / tests | `npm run lint:js` / `npm run test:js` | _pending_ | needs `npm install` |
| DB-backed suites (unit/services/api/e2e) | `openemr-cmd ut/st/at/et` | _needs David's Docker stack_ | |
| Runtime errors | David's run-through | 5 observations (B-01…B-05); dashboard-specific pass pending | from `DISCOVERY-GUIDE.md` §7 |

## Failures

| # | Check | Error (exact) | Location | Reproduces? | Severity guess | Catalog ID |
|---|---|---|---|---|---|---|
| B-01 | David's run-through | Unexplained pop-up asking for an email address; unclear whether the session is remembered | login / first screen | always (to confirm) | Low (UX); maybe product registration | _(Phase 7)_ |
| B-02 | David's run-through | Pages load slowly in general | across the app | always | Medium (performance) | _(Phase 7)_ |
| B-03 | David's run-through | No validation on many data-entry fields, e.g. SSN | demographics / data-entry forms | always | Medium (data quality) | _(Phase 7)_ |
| B-04 | David's run-through | Form field highlighting is hard to work with during data entry | data-entry forms | always | Low (UX) | _(Phase 7)_ |
| B-05 | David's run-through | Many tab pop-ups; how the parts authenticate is unclear | navigation / auth | always | Medium (UX, auth clarity) | _(Phase 7)_ |

## Missing checks

- _(to fill once all checks have run)_

## Notes

- `composer install` failed in the cloud container (exit 100). GitHub dist
  downloads weren't authenticated, and the fallback source clone then
  failed with "Could not authenticate against github.com". This is a
  limitation of the audit environment, not a repo defect. The PHP checks
  run on David's laptop stack instead (`openemr-cmd pit`, `pr`, `pst`).
