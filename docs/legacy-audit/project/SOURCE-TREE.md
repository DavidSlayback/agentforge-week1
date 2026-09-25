# Source Tree Audit

Audited by: tier 1 (haiku), 2026-09-25

## Directory Tree (top 2 levels)

```
Repository root: 9,097 tracked files total

./ (root level)
  73 files
  .github/ (76 files)
    FUNDING.yml, ISSUE_TEMPLATE/, PULL_REQUEST_TEMPLATE/, actionlint.yaml, actions/, copilot-instructions.md, dependabot.yml, docker/, problem-matchers/, release-targets.yml, requirements-spellcheck.txt, scripts/
  apis/ (5 files)
    .htaccess, dispatch.php, routes/ (3 files)
  agentforge/ (183 files)
    BUILD_SHA, api/ (2), corpus/ (3), package-lock.json, package.json, scripts/ (19), src/ (41), test/ (115)
  bin/ (6 files)
    .htaccess, command-runner, console, generate-phpstan-types.php, get-v-database.php, refresh-reserved-word-supplement.php
  ccdaservice/ (97 files)
    README.md, ccda_gateway.php, data-stack/ (2), oe-blue-button-generate/ (32), oe-blue-button-meta/ (12), oe-blue-button-util/ (9), package-lock.json, package.json, packages/ (15), serveccda.js, utils/ (22)
  ccr/ (32 files)
    ccd/ (17), ccr_view_retrieve.xsl, createCCR*.php (10 files), display.php, stylesheet/ (2), transmitCCD.php, uuid.php
  ci/ (47 files)
    README*.md, apache_* (10 compose configs), nginx_* (5 compose configs), compose-shared-* (4 configs)
  config/ (9 files)
    README.md, app.php, audit.php, cli.php, config.yaml, database.php, env.php, psr.php, services.php
  contrib/ (63 files)
    cqm_valueset, dsmiv, forms, icd10/ (3), icd9/ (2), portal_templates/ (20), rxnorm, snomed, util/ (31), venom
  custom/ (21 files)
    BillingExport.csv.php, ajax_download.php, assets/ (4), chart_tracker.php, code_types.inc.php, export_*.php (6 files)
  db/ (4 files)
    Migrations/ (2), README.md, migration-template.php.tpl
  deploy/ (7 files)
    vultr/ (7 files)
  docker/ (227 files)
    COVERAGE.md, README.md, binary/ (22), container_benchmarking/ (9), development-*/ (5 dirs), dockerhub/ (9), flex/ (19), library/ (129), production/ (2), release/ (26)
  docs/ (129 files)
    RELEASE_PROCESS.md, adr/ (2), agentforge/ (124), docker-migration-from-devops.md, release-automation-plan.md
  evals/ (14 files)
    README.md, deployed-service-results.json, error-analysis.json, lib/ (4), package.json, results.json, service-results.json, test/ (4)
  gacl/ (139 files)
    AUTHORS, CHANGELOG, COPYING.lib, CREDITS, Cache_Lite/ (3), FAQ, README, TODO, admin/ (51), docs/ (74), gacl.ini.php, other_languages/, phpdoc.phpgacl.ini, profiler.inc.php
  interface/ (1,879 files)
    README.md, batchcom/ (9), billing/ (31), clickmap/ (4), code_systems/ (10), couchdb/ (1), drugs/ (6), eRx*.php (7 files), easipro, esign, expand_contract_js.php, fax/ (files), forms/ (directories), forms_admin/, globals.php, help_modal.php, language/, login/, logout.php, logview/, main/, modules/, new/
  library/ (617 files)
    ADODB_mysqli_log.php, ESign/ (42), FeeSheet*.php (2 files), MedEx/ (3), admin/, ajax/ (42), amc.php, api.inc.php, appointment*.php (2 files), auth.inc.php, billing_sftp_service.php, calendar.inc.php, checkout_receipt_array.inc.php, clinical_rules.php, crypto/ (files), globals.inc.php, options.inc.php
  oauth2/ (2 files)
    .htaccess, authorize.php
  observability/ (6 files)
    README.md, index.js, test/ (4)
  output/ (1 file)
    pdf/ (1)
  portal/ (198 files)
    account/ (5), add_edit_event_user.php, find_appt_popup_user.php, get_*.php (10 files), home.php, images/ (3), patient resources
  sites/ (43 files)
    default/ (43 files)
  sql/ (45 files)
    2_6_0-to-2_6_1_upgrade.sql through 3_1_0-to-3_2_0_upgrade.sql (15 upgrade files)
  src/ (2,115 files)
    Appointment/, BC/ (11), Billing/ (43), ClinicalDecisionRules/ (55), Common/ (198), Console/ (4), Controllers/ (12), Core/ (19), Cqm/ (156), Easipro/, Encryption/ (19), Entities/ (4), Events/ (80), FHIR/ (918), Forms/ (3)
  swagger/ (19 files)
    favicon-*.png (2), index.css, index.html, oauth2-redirect.html, openemr-api.yaml, swagger-*.js (3 files)
  templates/ (243 files)
    api/ (2), calendar/ (15), carecoordination/ (2), core/ (5), dicom/, document_categories/ (2), documents/ (3), emails/ (12), encounter/, error/ (8), forms/ (2)
  tests/ (750 files)
    PHPStan/ (25), PHPUnit/ (2), README.md, Rector/ (9), Tests/ (653), api/ (2), bats/ (40), bootstrap.php, certification/, eventdispatcher/ (12), js/ (4)
  tools/ (19 files)
    ci/, release/ (18 files)
  webpack/ (2 files)
    loaders/ (2)

Excluded: vendor/, node_modules/, public/, Documentation/, contrib/, .phpstan/, .scratch/, output/ (per scope)
```

## Layer Assignment

| Directory | Layer | Files | Why |
|-----------|-------|-------|-----|
| src/ | module-business | 2,115 | PSR-4 modern business logic (Billing, ClinicalDecisionRules, FHIR, Events, etc.) |
| library/ | module-business | 617 | Legacy procedural business logic (clinical_rules, globals, options) |
| interface/ | UI | 1,879 | Web controllers and server-rendered templates (forms, patient_file, modules) |
| templates/ | UI | 243 | Twig template definitions (emails, errors, calendar, encounter) |
| tests/ | tests | 750 | PHPUnit, Rector, PHPStan, BATS, integration/e2e suites |
| docker/ | build-packaging | 227 | Docker configs, dev/prod compose, CI infrastructure |
| .github/ | build-packaging | 76 | CI/CD workflows, actions, release automation |
| ci/ | build-packaging | 47 | Docker compose configs for test matrix (PHP 8.2-8.6, MySQL 5.7-11.8) |
| ccdaservice/ | data asset | 97 | CCDA/CCD generation service (oe-blue-button, CQM service, XSL transforms) |
| ccr/ | data asset | 32 | CCR/CCD interchange XSL, creation, transmission |
| apis/ | module-business | 5 | API route dispatch, REST endpoint configuration |
| swagger/ | docs | 19 | OpenAPI 3.x spec (openemr-api.yaml) and Swagger UI assets |
| portal/ | UI | 198 | Patient portal PHP controllers and forms |
| gacl/ | third-party-vendored | 139 | phpGACL access control library (vendor-equivalent, shipped) |
| agentforge/ | AgentForge service | 183 | Agent orchestration, corpus, evals, test harness (Node.js) |
| evals/ | AgentForge service | 14 | Evaluation results, test data, gate logic |
| observability/ | AgentForge service | 6 | Observability/instrumentation (Node.js) |
| deploy/ | AgentForge service | 7 | Deployment config (Vultr provider) |
| sites/ | data asset | 43 | Facility/site configuration (default site) |
| sql/ | data asset | 45 | Database upgrade migration scripts (2.6.0 → 3.1.0) |
| db/ | build-packaging | 4 | Doctrine Migration templates and management |
| config/ | build-packaging | 9 | Container and environment config (app.php, database.php, services.php) |
| custom/ | module-business | 21 | Billing export, registry export, QR download utilities |
| controllers/ | module-business | 10 | Legacy controller classes (Document, Pharmacy, Prescription) |
| contrib/ | third-party-vendored | 63 | Third-party data (SNOMED, RxNorm, ICD-9/10, CQM valuesets, portal templates) |
| bin/ | build-packaging | 6 | CLI commands (console, command-runner, dev tools) |
| tools/ | build-packaging | 19 | Release and CI utility scripts |
| oauth2/ | module-business | 2 | OAuth2 authorization endpoint |
| webpack/ | build-packaging | 2 | Webpack loader configuration |
| docs/ | docs | 129 | Architecture documentation, ADRs, agentforge guides |
| meta/ | docs | 2 | Health metrics/metadata |
| output/ | build-packaging | 1 | Generated artifacts directory |

**Total: 9,097 files across 34 directories**

## Layer Summary

| Layer | File Count |
|-------|-----------|
| UI | 2,122 |
| module-business | 2,685 |
| tests | 750 |
| build-packaging | 1,384 |
| data asset | 217 |
| AgentForge service | 210 |
| third-party-vendored | 202 |
| docs | 131 |

## Patient Dashboard (`interface/patient_file/summary/`)

34 files, 10,946 total lines

| File | Lines |
|------|-------|
| demographics.php | 2,080 |
| immunizations.php | 1,275 |
| add_edit_issue.php | 1,065 |
| pnotes_full.php | 807 |
| demographics_full.php | 626 |
| labdata.php | 517 |
| stats_full.php | 509 |
| pnotes_full_add.php | 471 |
| demographics_save.php | 459 |
| browse.php | 456 |
| demographics_print.php | 378 |
| stats.php | 344 |
| shot_record.php | 298 |
| add_edit_amendments.php | 272 |
| disclosure_full.php | 243 |
| pnotes.php | 192 |
| record_disclosure.php | 179 |
| advancedirectives.php | 173 |
| list_amendments.php | 140 |
| pnotes_fragment.php | 137 |
| insurance_edit.php | 114 |
| disc_fragment.php | 114 |
| print_amendments.php | 113 |
| create_portallogin.php | 94 |
| pnotes_print.php | 77 |
| add_edit_issue_medication_fragment.php | 72 |
| lbf_fragment.php | 67 |
| labdata_fragment.php | 63 |
| track_anything_fragment.php | 58 |
| dashboard_header_simple_return.php | 51 |
| vitals_fragment.php | 49 |
| dashboard_header.php | 36 |
| clinical_reminders_fragment.php | 24 |
| patient_reminders_fragment.php | 23 |

## REST/FHIR API Surface

3 files defining 172 total routes

| File | Lines | GET | POST | PUT | PATCH | DELETE | Total |
|------|-------|-----|------|-----|-------|--------|-------|
| apis/routes/_rest_routes_standard.inc.php | 717 | 54 | 19 | 15 | 0 | 8 | 96 |
| apis/routes/_rest_routes_fhir_r4_us_core_3_1_0.inc.php | 876 | 65 | 3 | 3 | 0 | 0 | 71 |
| apis/routes/_rest_routes_portal.inc.php | 49 | 5 | 0 | 0 | 0 | 0 | 5 |

**Note:** Root `_rest_routes.inc.php` (36 lines) is an aggregator that includes the three route files above via `require_once`.

---

**Confidence: high** — Used `git ls-files` for authoritative file counting, `wc -l` for line counts, grep for route pattern matching across all route definition files.

**Escalate: none**
