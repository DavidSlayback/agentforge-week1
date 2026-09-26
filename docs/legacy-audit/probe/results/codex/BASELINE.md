# PHP baseline checks — codex — 2026-09-25

| Check | Command | Result | Notes |
|---|---|---|---|
| Isolated PHPUnit | `docker exec agentforge-week1-openemr-1 /root/devtools phpunit-isolated` | **Fail** (wrapper exit 0) | 3,474 tests; 24 failures, 3 warnings, 1 notice, 4 skipped, 14 incomplete. Summary: 8,627 assertions. First 20 failure findings are listed below. |
| PHP parse errors | `docker exec agentforge-week1-openemr-1 /root/devtools php-parserror` | **Pass** (exit 0) | No parse errors reported. One PHP 8.5 deprecation: `PatientPortalService::getRequest()` parameter `$param` is implicitly nullable (`src/Services/PatientPortalService.php:183`). |
| PSR-12 report | `docker exec agentforge-week1-openemr-1 /root/devtools psr12-report` | **Fail** (wrapper exit 0) | PHPCS reported 8 violations across 3 files: 2 import-order violations and 6 formatting violations in `sites/default/sqlconf.php`. |
| JavaScript lint report | `docker exec agentforge-week1-openemr-1 /root/devtools lint-javascript-report` | **Fail** (wrapper exit 0) | ESLint reported 3 errors in 3 files: one unnecessary escape and two empty blocks. |
| PHPStan | `docker exec agentforge-week1-openemr-1 /root/devtools phpstan` | **Skipped; interrupted** | After about 8 minutes, progress was 180/4,308 files (about 4%). This pace indicated the requested 20-minute ceiling would be exceeded; no result was reached. |
| PHP log | `docker exec agentforge-week1-openemr-1 /root/devtools php-log` | **Completed** (exit 0) | Printed about 4.6 MB of accumulated log output, including older unrelated entries. Latest entries during this probe were three identical `safe_href()` warnings blocking the `javascript` URL scheme. |

## Failures

First 20 distinct PHPUnit failure findings, in command output order. The isolated PHPUnit wrapper still exited 0.

| # | Check | Error (exact) | Location | Reproduces? | Severity guess |
|---|---|---|---|---|---|
| C-01 | PHPUnit | Rendered output does not match fixture; failed asserting two strings are identical; line endings differ. | `tests/Tests/Isolated/Common/Twig/fixtures/render/nav-icon-local-link.html` | Yes, observed in this run | Low: fixture rendering mismatch |
| C-02 | PHPUnit | Rendered output does not match fixture; failed asserting two strings are identical; line endings differ. | `tests/Tests/Isolated/Common/Twig/fixtures/render/nav-icon-external-link.html` | Yes, observed in this run | Low: fixture rendering mismatch |
| C-03 | PHPUnit | Rendered output does not match fixture; failed asserting two strings are identical; line endings differ. | `tests/Tests/Isolated/Common/Twig/fixtures/render/ehr-launch-autosubmit.html` | Yes, observed in this run | Low: fixture rendering mismatch |
| C-04 | PHPUnit | Rendered output does not match fixture; failed asserting two strings are identical; line endings differ. | `tests/Tests/Isolated/Common/Twig/fixtures/render/autologin-pin-required.html` | Yes, observed in this run | Low: fixture rendering mismatch |
| C-05 | PHPUnit | Rendered output does not match fixture; failed asserting two strings are identical; line endings differ. | `tests/Tests/Isolated/Common/Twig/fixtures/render/autologin-no-pin.html` | Yes, observed in this run | Low: fixture rendering mismatch |
| C-06 | PHPUnit | Rendered output does not match fixture; failed asserting two strings are identical; line endings differ. | `tests/Tests/Isolated/Common/Twig/fixtures/render/appointments-all-hidden.html` | Yes, observed in this run | Low: fixture rendering mismatch |
| C-07 | PHPUnit | Rendered output does not match fixture; failed asserting two strings are identical; line endings differ. | `tests/Tests/Isolated/Common/Twig/fixtures/render/appointments-future-empty.html` | Yes, observed in this run | Low: fixture rendering mismatch |
| C-08 | PHPUnit | Rendered output does not match fixture; failed asserting two strings are identical; line endings differ. | `tests/Tests/Isolated/Common/Twig/fixtures/render/calendar-month-print-empty.html` | Yes, observed in this run | Low: fixture rendering mismatch |
| C-09 | PHPUnit | Rendered output does not match fixture; failed asserting two strings are identical; line endings differ. | `tests/Tests/Isolated/Common/Twig/fixtures/render/calendar-week-print-empty.html` | Yes, observed in this run | Low: fixture rendering mismatch |
| C-10 | PHPUnit | Rendered output does not match fixture; failed asserting two strings are identical; line endings differ. | `tests/Tests/Isolated/Common/Twig/fixtures/render/calendar-day-print-empty.html` | Yes, observed in this run | Low: fixture rendering mismatch |
| C-11 | PHPUnit | Rendered output does not match fixture; failed asserting two strings are identical; line endings differ. | `tests/Tests/Isolated/Common/Twig/fixtures/render/calendar-month-screen-empty.html` | Yes, observed in this run | Low: fixture rendering mismatch |
| C-12 | PHPUnit | Rendered output does not match fixture; failed asserting two strings are identical; line endings differ. | `tests/Tests/Isolated/Common/Twig/fixtures/render/calendar-day-screen-empty.html` | Yes, observed in this run | Low: fixture rendering mismatch |
| C-13 | PHPUnit | Rendered output does not match fixture; failed asserting two strings are identical; line endings differ. | `tests/Tests/Isolated/Common/Twig/fixtures/render/calendar-week-screen-empty.html` | Yes, observed in this run | Low: fixture rendering mismatch |
| C-14 | PHPUnit | Rendered output does not match fixture; failed asserting two strings are identical; line endings differ. | `tests/Tests/Isolated/Common/Twig/fixtures/render/appointments-with-future.html` | Yes, observed in this run | Low: fixture rendering mismatch |
| C-15 | PHPUnit | Failed asserting that two arrays are identical; expected status `executed` was absent from the actual result. | `tests/Tests/Isolated/Services/Background/SymfonyBackgroundServiceSpawnerTest.php` (`testExecutedStatusParsedFromJson`) | Yes, observed in this run | Medium: status parsing behavior |
| C-16 | PHPUnit | Failed asserting that two arrays are identical; expected status `not_due` was absent from the actual result. | `tests/Tests/Isolated/Services/Background/SymfonyBackgroundServiceSpawnerTest.php` (`testStatusParsedFromTrailingJsonAmongstOtherOutput`) | Yes, observed in this run | Medium: status parsing behavior |
| C-17 | PHPUnit | Failed asserting that 2 is identical to 137. | `tests/Tests/Isolated/Services/Background/SymfonyBackgroundServiceSpawnerTest.php:241` (`testNonZeroExitReturnsErrorAndLogsService`) | Yes, observed in this run | Medium: child process exit handling |
| C-18 | PHPUnit | Legitimate error status should not log a spawner warning; failed asserting that two arrays are identical. | `tests/Tests/Isolated/Services/Background/SymfonyBackgroundServiceSpawnerTest.php` (`testShutdownFunctionForgedStatusLineIsRejectedByNonceCheck`) | Yes, observed in this run | Medium: status validation/logging |
| C-19 | PHPUnit | TAB must be rendered as literal `\t`; actual stderr contains `syntax error: unexpected word (expecting "do")`. | `tests/Tests/Isolated/Services/Background/SymfonyBackgroundServiceSpawnerTest.php:317` (`testStderrIsSanitizedAndTruncatedBeforeLogging`) | Yes, observed in this run | Low: shell fixture/runtime mismatch suspected |
| C-20 | PHPUnit | Failed asserting that null is identical to 65536. | `tests/Tests/Isolated/Services/Background/SymfonyBackgroundServiceSpawnerTest.php:365` (`testStdoutOverflowTerminatesChildAndReturnsError`) | Yes, observed in this run | Medium: child output overflow handling |

Additional observed check failures not included in the first 20 PHPUnit findings:

- PSR-12: `Use statements should be sorted alphabetically. The first wrong one is OpenEMR\Common\Acl\AclMain.` at `interface/modules/custom_modules/oe-module-agentforge/public/index.php:7`; same rule reports `OpenEMR\Modules\AgentForge\Api\AclChecker` at `interface/modules/custom_modules/oe-module-agentforge/tests/run.php:50`.
- PSR-12: `Header blocks must be separated by a single blank line`; `Spaces must be used for alignment; tabs are not allowed` (five occurrences) in `sites/default/sqlconf.php` lines 1 and 5.
- JavaScript: `Unnecessary escape character: \w` at `agentforge/src/ui.js:109:106`.
- JavaScript: `Empty block statement` at `agentforge/test/openemr-module-roundtrip.test.js:33:90` and `evals/lib/runner.js:7:313`.
- PHPUnit reported four further failures after C-20; they are not expanded here. The exact run summary is in the first row.
