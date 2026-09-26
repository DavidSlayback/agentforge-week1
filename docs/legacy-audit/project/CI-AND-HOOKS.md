Audited by: tier 2 (sonnet)
Date: 2026-09-25
Git SHA: 3ccfe1d

# CI and hooks

## Where this project actually merges

`git remote -v` shows four remotes: `origin` → GitHub
(`DavidSlayback/agentforge-week1.git`), `gitlab` and `staging` → GitLab
(`labs.gauntletai.com`), `upstream` → GitHub (`Gauntlet-HQ/openemr-base-clean.git`,
the base OpenEMR fork this repo is built on). Per `AGENTS.md` ("One branch,
one deployed SHA"), integration happens on GitLab `main` (`staging` remote),
and per the same file, "the GitLab project has no CI runner (owner decision,
2026-09-24), so the enforced gate is `.githooks/pre-commit`". This audit did
not attempt any network call to confirm whether GitHub Actions are enabled on
the `origin` mirror (out of scope: read-only, no network) — the workflow
inventory below records what each `.github/workflows/*.yml` file is
configured to do, not whether it currently executes anywhere.

`git config --local core.hooksPath` in this checkout returns `.githooks`,
confirming `.githooks/pre-commit` is the hook Git actually invokes on
`git commit` here (not `.pre-commit-config.yaml`'s default `.git/hooks/`
location, and not any GitHub Action).

## `.githooks/pre-commit` (the enforced gate)

`.githooks/pre-commit:1-49`. Runs on every local `git commit` once
`core.hooksPath` is set to `.githooks` (per `AGENTS.md`/`CLAUDE.md`
instructions, e.g. via `openemr-cmd prek-install`, or by manually setting the
git config, as is already the case in this checkout). Steps, in order:
1. Requires `node` on `PATH`; refuses otherwise — `.githooks/pre-commit:10-13`.
2. Runs `npm ci --prefix agentforge` if `agentforge/node_modules` is missing
   or stale relative to `agentforge/package-lock.json` — `.githooks/pre-commit:15-18`.
3. If `php` is on `PATH`: `php -l` on every `*.php` file under
   `interface/modules/custom_modules/oe-module-agentforge`, then runs that
   module's own dependency-free test runner
   (`oe-module-agentforge/tests/run.php`) — `.githooks/pre-commit:29-35`. If
   `php` is missing *and* the commit touches that module directory, the hook
   fails outright — `.githooks/pre-commit:36-38`.
4. `npm test --prefix agentforge`, `npm test --prefix evals`, and
   `node --test observability/test/*.test.js` — `.githooks/pre-commit:43-46`.
5. `node agentforge/scripts/run-w2-gate.mjs` (the W2 50-case regression gate)
   — `.githooks/pre-commit:48-49`.

This hook does **not** invoke PHPStan, PHPCS/PHPCBF, Rector, Composer
Require Checker, the OpenEMR-wide PHPUnit suite (DB-backed or isolated), or
ESLint/stylelint/Jest for the wider codebase — its only PHP check is
`php -l` plus one module's bespoke test runner.

## `.gitlab-ci.yml` (mirror of the above; only runs if GitLab ever gets a runner)

`.gitlab-ci.yml:1-44`. File header states it explicitly: "AgentForge
merge-request gate. GitHub workflows under `.github/` do not run on GitLab;
this file is the only CI gate that can block a merge request here"
(`.gitlab-ci.yml:1-2`). Per `AGENTS.md`, the GitLab project currently has no
runner, so this file is configured but not presently executable — it exists
so the same checks run automatically the moment a runner is attached, and so
its `script:` stays in sync with `.githooks/pre-commit`'s manual steps.
Jobs:
- `agentforge-tests` (stage `test`, image `node:24-alpine`, installs
  `poppler-utils`/`tesseract-ocr`): `npm test --prefix agentforge`,
  `npm test --prefix evals`, `node --test observability/test/*.test.js` —
  `.gitlab-ci.yml:23-29`.
- `agentforge-module-php` (stage `test`, image `php:8.4-cli-alpine`):
  `php -l` over `oe-module-agentforge/*.php` and its `tests/run.php` —
  `.gitlab-ci.yml:32-37`. Comment: "Mirrors the module PHP step of
  `.githooks/pre-commit` (always required here)" — `.gitlab-ci.yml:31`.
- `w2-regression-gate` (stage `eval`): `npm run eval:gate --prefix agentforge`
  — `.gitlab-ci.yml:39-44`.

Same gap as the pre-commit hook: no PHPStan/PHPCS/PHPUnit(core)/ESLint here
either.

## `.pre-commit-config.yaml` (present, not the active local hook in this checkout)

`.pre-commit-config.yaml:1-241`. This is the upstream/generic OpenEMR
pre-commit config (per `CLAUDE.md`'s "Code Quality" section, normally wired
via `openemr-cmd prek-install` or `prek install`/`pre-commit install`, which
target `.git/hooks/pre-commit`). Because this checkout's
`core.hooksPath = .githooks` (confirmed above), `.git/hooks/pre-commit` is
bypassed entirely by plain `git commit` — this file's hooks only run when
someone explicitly invokes `prek run` / `pre-commit run` by hand, or via the
`pre-commit.yml` GitHub Action (GitHub-only, see below). Local hooks defined
here (`.pre-commit-config.yaml:180-241`) include `php-syntax-check` (`php -l`),
`composer-validate`, `composer-normalize`, `phpcbf`, **`phpcs`**,
**`phpstan`**, `rector` (`composer rector-fix --`), `composer-require-checker`,
and a `commit-msg`-stage `conventional-commits` check. Plus upstream hooks:
`trailing-whitespace`, `end-of-file-fixer`, `check-yaml` (x2), `check-added-large-files`,
`check-merge-conflict`, `check-json`, `pretty-format-json` (x2), `mixed-line-ending`,
`pretty-format-yaml`, `codespell`, `actionlint-docker`, `hadolint`. No PHPUnit
hook and no ESLint/Jest hook are defined anywhere in this file — confirmed via
`grep -n "phpunit\|eslint\|jest" .pre-commit-config.yaml` (no matches).

## `.github/workflows/*.yml` (57 files; GitHub-only per `AGENTS.md`, so none block the GitLab merge path)

Full directory listing captured via `ls .github/workflows/`. Table covers the
workflows most relevant to the "what actually gets checked" question (quality
gates, tests, dependabot automation); the remainder (docker build/test/release
matrix jobs, database-version, api-docs, spellcheck, semgrep, shellcheck,
whitespace, syntax, inferno, byte-identical/release-prep tooling) all share the
same "Runs: no" answer for this repo and are omitted from the row-by-row
table below to keep it readable — every one of them triggers only on
`push`/`pull_request` against GitHub, which this project's actual merge path
(GitLab, no runner) never invokes.

| Gate | File | Trigger | Runs | Actually enforced here? (yes/no + why) |
|---|---|---|---|---|
| PHPStan | `.github/workflows/phpstan.yml:1-10` | push/PR to `master`/`rel-*` | `composer phpstan` (`phpstan.yml:37` removes rector first, then runs phpstan level 10 per `composer.json`) | No — GitHub Actions do not run on this project's GitLab merge path (`AGENTS.md`); not mirrored in `.githooks/pre-commit` or `.gitlab-ci.yml` |
| Styling (PHPCS + stylelint + ESLint) | `.github/workflows/styling.yml:1-107` | push/PR to `master`/`rel-*` | Three jobs: `PHP` job runs `composer phpcs -- --report=full,emacs` (`styling.yml:39`); `CSS` job runs `npm run stylelint` (`styling.yml:73`); `JS` job runs `npm run lint:js` (`styling.yml:107`) | No — same reason |
| Isolated Tests (PHPUnit) | `.github/workflows/isolated-tests.yml:1-80` | push/PR to `master`/`rel-*`; matrix over PHP 8.2-8.6 | `vendor/bin/phpunit -c phpunit-isolated.xml --coverage-clover=clover.xml --log-junit=junit.xml` (`isolated-tests.yml:49-52`) | No — same reason |
| Test / Test-All (PHPUnit, DB-backed) | `.github/workflows/test.yml` (reusable) + `.github/workflows/test-all.yml` | `test-all.yml`: push/PR (PR default limited to PHP 8.2 unless `Test-Mode: full` trailer) | `test.yml` spins up a docker dev directory, installs OpenEMR, then fans out `unit`/`api`/`e2e`/`services` PHPUnit-based suites (same suites as `openemr-cmd cst`) | No — same reason |
| JS Unit Test (Jest) | `.github/workflows/js-test.yml:1-11` | push/PR to `master`/`rel-*` | `npm run test:js` (`js-test.yml:54`) | No — same reason |
| Rector | `.github/workflows/rector.yml:1-10` | push/PR to `master`/`rel-*` | Rector dry-run/check (cache-keyed on installed rector version) | No — same reason |
| Pre-commit (runs `.pre-commit-config.yaml` in CI) | `.github/workflows/pre-commit.yml:1-17` | push/PR touching `.github/workflows/*.yml` or `.pre-commit-config.yaml` | `j178/prek-action@v2` (`pre-commit.yml:42`), i.e. runs the same hooks as `.pre-commit-config.yaml` above (incl. phpstan/phpcs/rector) | No — same reason; also path-scoped so it wouldn't fire on most PHP changes even on GitHub |
| Composer Checks | `.github/workflows/composer.yml:1-10` | push/PR to `master`/`rel-*` | `composer validate`/`composer normalize`-style checks | No — same reason |
| Composer Require Checker | `.github/workflows/composer-require-checker.yml` | push/PR touching `**.php`, `composer.json`/`.lock`, or the workflow file | `composer require-checker` | No — same reason |
| Conventional Commits | `.github/workflows/conventional-commits.yml:1-12` | PR opened/edited/synchronize, `master`/`rel-*` | Validates PR-title/commit format | No — same reason. Locally, `conventional-commits:check` IS enforced via `.pre-commit-config.yaml`'s `commit-msg`-stage hook (`.pre-commit-config.yaml:235-241`), but only when that hook is active (see caveat above about `core.hooksPath`) |
| All Checks Passed | `.github/workflows/all-checks-passed.yml:1-12` | push/PR to `master` | Branch-protection aggregator (`wait-on-check-action`) — meaningless without the above jobs actually running | No — same reason |
| Dependabot Auto-Merge | `.github/workflows/dependabot-auto-merge.yml:1-14` | `pull_request_target`, `master`, actor = `dependabot[bot]` | Auto-merges Dependabot PRs | No — same reason; also Dependabot itself targets GitHub, and this repo's dependency PRs would need to land on GitHub before this could act |

**Explicit answer to the task's question:** PHPStan, PHPCS, the OpenEMR-wide
PHPUnit suites (isolated and DB-backed), and ESLint/Jest all exist as
configured checks in this repository, but **none of them run in any gate
that is actually enforced for this project** (`.githooks/pre-commit` /
`.gitlab-ci.yml`). They are defined only in `.github/workflows/*.yml`
(GitHub Actions) and, for phpstan/phpcs/rector specifically, in
`.pre-commit-config.yaml` (which is not the git hook wired up in this
checkout). The only checks that are actually enforced for this project's
AgentForge-scoped work are: `agentforge`/`evals` unit tests, an
`observability` node test run, one module's `php -l` + bespoke test runner,
and the W2 50-case eval gate (`.githooks/pre-commit`, mirrored — pending a
runner — by `.gitlab-ci.yml`).

## `.github/dependabot.yml`

`.github/dependabot.yml:1-215` (approx; full-file `package-ecosystem`
entries: `composer` at `/`, weekly Monday; `npm` at `/`, weekly Monday;
`github-actions`, weekly Monday; `pre-commit` (bumps `.pre-commit-config.yaml`
hook revs), weekly Monday; `docker-compose` for `ci/compose-shared-selenium/`,
daily; `docker-compose` for the large `ci/apache_*`/`ci/nginx_*`/etc. list,
daily, with major/minor bumps blocked for version-pinned images
(mariadb/mysql/openemr/openemr/dev-php-fpm); `docker-compose` for
`docker/development-easy/`, `docker/development-easy-light/`,
`docker/development-easy-redis/`, `docker/production/`, daily, major mariadb
bumps blocked; `docker-compose` for `docker/development-insane/`, daily, major
+ minor blocked for the version-matrix images; `npm` at `/ccdaservice`,
weekly Monday). This is a GitHub-native feature (opens PRs against `origin`
on GitHub) — it has no GitLab equivalent and does not interact with the
`.githooks`/`.gitlab-ci.yml` enforcement path at all.

## Notes / redactions

No secrets found in any of the files audited here (`.githooks/pre-commit`,
`.gitlab-ci.yml`, `.pre-commit-config.yaml`, `.github/workflows/*.yml`,
`.github/dependabot.yml`) — these are CI/hook configuration files with no
embedded credentials.
