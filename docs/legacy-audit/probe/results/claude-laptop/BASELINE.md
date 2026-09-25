# PHP baseline checks — claude-laptop — 2026-09-25

Container `agentforge-week1-openemr-1` (`docker/development-easy-light`),
repo at `3ccfe1d` (`agentforge/w2-final` = `staging/main`), Windows host with
`core.autocrlf=true` (system gitconfig). All commands read-only, run via
`MSYS_NO_PATHCONV=1 docker exec agentforge-week1-openemr-1 /root/devtools <cmd>`.

| Check | Command | Result | Notes |
|---|---|---|---|
| Isolated PHPUnit | `phpunit-isolated` | **24 failures** (wrapper exit 0), 102 s | 3,474 tests, 8,627 assertions; 24 F, 3 W, 1 N, 4 skipped, 14 incomplete. **All 24 failures are CRLF checkout artifacts** (L-01, L-02). Identical counts to Codex. |
| PHP parse errors | `php-parserror` | **Pass**, 258 s | 0 parse errors. 1 PHP 8.5 deprecation (L-03). |
| PSR-12 | `psr12-report` | **8 errors in 3 files** (wrapper exit 0), 173 s | L-04, L-05. Same as Codex. |
| ESLint | `lint-javascript-report` | **3 errors in 3 files**, 16 s | All in AgentForge code, not OpenEMR (L-06). |
| PHPStan level 10 | `phpstan` (detached in container) | **401 errors**, exit 0, 15 min 16 s | ~273 in `oe-module-agentforge` (real, fork code); ~128 in unchanged upstream files, 116 of them `ignore.unmatched` (likely CRLF). Codex stopped at 4% after 8 min, probably because of contention. |
| PHP log | `php-log` | not re-run | Codex captured it (4.6 MB, old entries; latest = `safe_href()` blocked `javascript:` ×3). |

## Findings

| # | Check | Error (exact) | Location | Cause | Severity |
|---|---|---|---|---|---|
| L-01 | PHPUnit | "Rendered output does not match fixture … line endings differ" ×14 | `tests/Tests/Isolated/Common/Twig/fixtures/render/*.html` | Fixtures are `i/lf w/crlf` (`git ls-files --eol`): LF in git, CRLF on this disk; the container reads the Windows bind mount. **Environment, not repo.** Inferred from PHPUnit's own diff message; not re-run with LF. | None for the port; noise in the laptop baseline |
| L-02 | PHPUnit | `bin/console: line 11: syntax error: unexpected word (expecting "do")` and 9 related spawner failures | `tests/Tests/Isolated/Services/Background/SymfonyBackgroundServiceSpawnerTest.php` | The test writes a shell script from a PHP heredoc; the PHP file is CRLF on disk, so the script gets `do\r`. **Proven**: the LF copy from `git show HEAD:` passes 19/19 in the same container. **Environment, not repo.** | None for the port |
| L-03 | php -l | `PatientPortalService::getRequest(): Implicitly marking parameter $param as nullable is deprecated` | `src/Services/PatientPortalService.php:183` | Real, upstream OpenEMR | Low |
| L-04 | PHPCS | `Use statements should be sorted alphabetically` (first wrong: `AclMain`; `AclChecker`) | `interface/modules/custom_modules/oe-module-agentforge/public/index.php:7`, `…/tests/run.php:50` | Real, AgentForge module | Low |
| L-05 | PHPCS | header blank line + 5× tabs for alignment | `sites/default/sqlconf.php:1,5` | `sites/` is the Docker volume `agentforge-week1_sitesvolume` (`docker inspect` mounts), written by the dev-stack installer — **environment, not the tracked file** | None |
| L-06 | ESLint | `no-useless-escape` (`\w`); `no-empty` ×2 | `agentforge/src/ui.js:109`, `agentforge/test/openemr-module-roundtrip.test.js:33`, `evals/lib/runner.js:7` | Real, AgentForge code (not OpenEMR) | Low |
| L-07 | PHPUnit | 3 warnings + 1 notice | `vendor/particle/validator/src/Validator.php:265` ×2, `vendor/league/oauth2-server/src/CryptKey.php:74`, `src/Cqm/Qdm/BaseTypes/AbstractType.php:23` | Vendor/upstream deprecations | Low |

## Disagreement with Codex

- **Counts agree** on every check (PHPUnit 24 F / 3 W / 1 N, PHPCS 8 in 3
  files, ESLint 3 in 3 files, 0 parse errors). Both runs used the same
  container, which bind-mounts the main checkout.
- **Cause of the 24 PHPUnit failures.** Codex classified 6 spawner failures
  as "Medium: status parsing / child process behavior". They are a CRLF
  artifact (L-02, proven).
