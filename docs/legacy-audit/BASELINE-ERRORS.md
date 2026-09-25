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
| OpenEMR isolated PHPUnit | `composer phpunit-isolated` | _pending_ | waiting on `composer install` |
| PHP style | `composer phpcs` | _pending_ | waiting on `composer install` |
| PHPStan level 10 | `composer phpstan` | _pending_ | waiting on `composer install`; full codebase |
| JS lint / tests | `npm run lint:js` / `npm run test:js` | _pending_ | needs `npm install` |
| DB-backed suites (unit/services/api/e2e) | `openemr-cmd ut/st/at/et` | _needs David's Docker stack_ | |
| Runtime errors | David's run-through | _pending_ | from `DISCOVERY-GUIDE.md` §7 |

## Failures

| # | Check | Error (exact) | Location | Reproduces? | Severity guess | Catalog ID |
|---|---|---|---|---|---|---|
| _none yet_ | | | | | | |

## Missing checks

- _(to fill once all checks have run)_

## Notes

- `composer install` falls back to cloning from source because GitHub dist
  downloads aren't authenticated in this container. It's slow, but it
  hasn't failed.
