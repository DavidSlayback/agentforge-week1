# What's Missing: OpenEMR and AgentForge

Audited by: tier 1 (haiku), 2026-09-25 · **Reviewed and corrected by tier 3 (opus)**. Rows
marked *(t3)* were changed in review.

| Capability | OpenEMR | OpenEMR evidence | AgentForge | AgentForge evidence |
|---|---|---|---|---|
| Automated tests (which layers) | present | `phpunit.xml`, `phpunit-isolated.xml`, `phpunit.integration.xml`, `jest.config.js`; `tests/Tests/Isolated/` (unit), `tests/Tests/Services/`, `tests/Tests/E2e/`, `tests/Tests/Api/` | present | `agentforge/test/` (50+ files), `evals/test/`, `observability/test/` |
| CI running build + tests | **missing** *(t3)* | The GitLab project has no runner (AGENTS.md). The enforced gate `.githooks/pre-commit`, mirrored by `.gitlab-ci.yml`, runs no OpenEMR PHPUnit, PHPStan, PHPCS or ESLint (`CI-AND-HOOKS.md`). Upstream `.github/workflows/*` exist but don't run here. | **partial** *(t3)* | `.githooks/pre-commit` runs the agentforge, evals and observability tests plus the W2 gate on each local commit; `.gitlab-ci.yml` mirrors it with no runner |
| Setup / build docs | present | `CONTRIBUTING.md` (Docker dev env, tests, code quality, build), `CLAUDE.md`, `README.md` | present | `deploy/vultr/README.md`, `AGENTS.md` |
| Architecture docs | **partial** *(t3)* | Nothing on OpenEMR's own architecture beyond `API_README.md` and `FHIR_README.md`; the docs cited in the draft (`docs/agentforge/*`) describe AgentForge | present | `docs/agentforge/ARCHITECTURE.md`, `W2_ARCHITECTURE.md`, `DECISIONS.md`, `docs/agentforge/diagrams/` |
| Backups and restore | **partial** *(t3)* | `contrib/util/backup_oemr.sh` (mysqldump; `contrib/` is outside the audit scope); `openemr-cmd backup-snapshot` / `restore-snapshot` are dev-stack snapshots (`CONTRIBUTING.md`). No documented production backup or restore for this deployment | partial | Stateless service; no backup strategy for the Langfuse stack (`deploy/vultr/langfuse/`) |
| Monitoring and alerting | **missing** *(t3)* | No monitoring or alerting config for OpenEMR in this repo. The draft's "FHIR API metrics" claim had no evidence; Monolog is logging, not monitoring | present | `observability/index.js` (`evaluateAlerts`, `createReadinessChecker`), `deploy/vultr/langfuse/`, `docs/agentforge/OBSERVABILITY.md` |
| Logging with correlation IDs | **unverified** *(t3)* | Monolog present; no correlation-ID evidence cited. To check in Phase 3 | present | `agentforge/src/contracts.js` (`correlationId`), threaded through `answerComposer.js` |
| Health / readiness checks | present | `/meta/health/readyz` (routed via `src/BC/FallbackRouter.php`; used as the healthcheck at `deploy/vultr/docker-compose.yml:55`) | present | `/ready` on 8787 and 8788 (`deploy/vultr/docker-compose.yml`) |
| Input validation at boundaries | **partial** *(t3)* | Validators exist in places (`src/Validators/`, FHIR services), but David saw no validation on SSN and other fields (B-03) | present | Zod schemas (`agentforge/src/schemas.js`); `validate*` in `contracts.js`, `activeWorkers.js` |
| Authentication / authorization model | present | OAuth2/OIDC (`oauth2/`, `src/RestControllers/AuthorizationController.php`), gacl ACL (`AclMain`), SMART scopes. See `api/AUTH-AND-PATIENT.md` | present | HMAC request signing with nonce-replay defence (`oe-module-agentforge/src/Http/RequestAuthenticator.php`, `AccessPolicy.php`) |
| Secrets management | partial | Environment variables and `sites/*/sqlconf.php`; no vault | present | `process.env` only; `.env` files in `deploy/vultr/`; redaction rules (AGENTS.md) |
| Dependency pinning and updates | present | `composer.lock`, `package-lock.json`; `.github/dependabot.yml` (GitHub only; its PRs were closed during the 2026-09-25 reconciliation) | present | `agentforge/package-lock.json`; `npm ci` in the hook |
| Versioned schema / migrations | present | `sql/*_upgrade.sql` versioned upgrade scripts | n/a | No database of its own (read-only service; fixtures in `agentforge/test/fixtures/`) |
| Accessibility | **partial** *(t3)* | ARIA in 84 `templates/` and `interface/` files (grep `aria-`); no accessibility tests or audit. The draft's `Documentation/` evidence is out of scope | **partial** *(t3)* | ARIA in `agentforge/src/ui.js`; no accessibility tests |
| Internationalization | present | `xl()` / `xlt()` throughout `interface/`; translation tables in the DB | partial | English only; no i18n in `agentforge/src` |
| License and provenance | present | `LICENSE` (GPL-3); upstream `Gauntlet-HQ/openemr-base-clean` @ `ef3d490` | present | Same GPL-3; AI-assistance trailers (`CONTRIBUTING.md`) |

## Summary

- **OpenEMR:** 8 present, 5 partial (architecture docs, backups, input
  validation, secrets, accessibility), 2 missing (CI for this fork,
  monitoring), 1 unverified (correlation IDs).
- **AgentForge:** 11 present, 4 partial (CI, backups, accessibility, i18n),
  1 n/a (schema).

**For the dashboard port:** the missing CI matters most. The new app will need its
own gate in `.githooks/pre-commit`, because nothing else runs.

## Review note

The tier-1 draft overstated coverage: it gave 14 of 16 "present" for both
scopes, and its summary counts didn't match its own rows. Eight rows changed
in review. **Calibration outcome:** judgment-heavy checklists go to tier 2; tier 1
stays on mechanical listing (for example `SOURCE-TREE.md`).
