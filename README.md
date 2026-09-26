[![Syntax Status](https://github.com/openemr/openemr/actions/workflows/syntax.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/syntax.yml)
[![Styling Status](https://github.com/openemr/openemr/actions/workflows/styling.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/styling.yml)
[![Testing Status](https://github.com/openemr/openemr/actions/workflows/test.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/test.yml)
[![JS Unit Testing Status](https://github.com/openemr/openemr/actions/workflows/js-test.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/js-test.yml)
[![PHPStan](https://github.com/openemr/openemr/actions/workflows/phpstan.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/phpstan.yml)
[![Rector](https://github.com/openemr/openemr/actions/workflows/rector.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/rector.yml)
[![ShellCheck](https://github.com/openemr/openemr/actions/workflows/shellcheck.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/shellcheck.yml)
[![Docker Compose Linting](https://github.com/openemr/openemr/actions/workflows/docker-compose-lint.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/docker-compose-lint.yml)
[![Dockerfile Linting](https://github.com/openemr/openemr/actions/workflows/docker-lint-hadolint.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/docker-lint-hadolint.yml)
[![Isolated Tests](https://github.com/openemr/openemr/actions/workflows/isolated-tests.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/isolated-tests.yml)
[![Inferno Certification Test](https://github.com/openemr/openemr/actions/workflows/inferno-test.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/inferno-test.yml)
[![Composer Checks](https://github.com/openemr/openemr/actions/workflows/composer.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/composer.yml)
[![Composer Require Checker](https://github.com/openemr/openemr/actions/workflows/composer-require-checker.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/composer-require-checker.yml)
[![API Docs Freshness Checks](https://github.com/openemr/openemr/actions/workflows/api-docs.yml/badge.svg)](https://github.com/openemr/openemr/actions/workflows/api-docs.yml)
[![codecov](https://codecov.io/gh/openemr/openemr/graph/badge.svg?token=7Eu3U1Ozdq)](https://codecov.io/gh/openemr/openemr)

[![Backers on Open Collective](https://opencollective.com/openemr/backers/badge.svg)](#backers) [![Sponsors on Open Collective](https://opencollective.com/openemr/sponsors/badge.svg)](#sponsors)

# AgentForge (built on OpenEMR)

AgentForge is a Clinical Co-Pilot built as a fork of
[OpenEMR](https://open-emr.org), the Free and Open Source electronic health
records system. This README leads with AgentForge — the Week 1/Week 2
project — and keeps the original OpenEMR project information further down
for anyone working on the underlying EHR.

## Grader quick path

**Deployed URLs**

| What | URL |
|---|---|
| Week 2 (current submission) | <https://dtstest.64.177.10.182.nip.io/agentforge-w2/> |
| Week 1 (frozen at `84f232b`, separate route/image, not part of this submission) | <https://dtstest.64.177.10.182.nip.io/agentforge/> |
| Observability dashboard | `<W2 URL>/observability` |
| Eval report | `<W2 URL>/evals` |
| Health / deployed SHA | `<W2 URL>/health` returns `{status, git_sha}` |

**Patient dashboard port (W2 surprise challenge).** A React SPA with a BFF that
reimplements OpenEMR's PHP patient dashboard on its REST/FHIR API. It runs at
<https://dtstest.64.177.10.182.nip.io/dashboard/> (deployed SHA:
`/dashboard/health`). Sign in, then open demo patient MRN `DASH-SYN-01`
(data-rich) or `DASH-SYN-02` (deceased). The defense is in
[`PATIENT_DASHBOARD_MIGRATION.md`](PATIENT_DASHBOARD_MIGRATION.md), and the
code is in [`dashboard/`](dashboard/README.md).

**Sample documents.** Four synthetic filled PDFs exercise both document types
and both OCR layouts — a vector-text layout and a rasterized-page layout that
exercises real OCR over pixels:

- [`docs/agentforge/fixtures/scan-forms/pdf-samples/filled-lab-a.pdf`](docs/agentforge/fixtures/scan-forms/pdf-samples/filled-lab-a.pdf)
- [`docs/agentforge/fixtures/scan-forms/pdf-samples/filled-lab-b.pdf`](docs/agentforge/fixtures/scan-forms/pdf-samples/filled-lab-b.pdf)
- [`docs/agentforge/fixtures/scan-forms/pdf-samples/filled-intake-a.pdf`](docs/agentforge/fixtures/scan-forms/pdf-samples/filled-intake-a.pdf)
- [`docs/agentforge/fixtures/scan-forms/pdf-samples/filled-intake-b.pdf`](docs/agentforge/fixtures/scan-forms/pdf-samples/filled-intake-b.pdf)

The deployed UI's home page has a "Run this sample" button and a download
link for each of the four, so a grader never has to find these files on
disk to try the flow.

**5-step demo**

1. **Upload** one of the four sample PDFs (or your own PDF/`.scan.txt` test
   envelope) against a seeded synthetic patient.
2. **Overlay preview** — the rendered page shows a bounding box per extracted
   field; clicking a citation in the answer scrolls to and highlights its box.
3. **Grounded answer** — the response separates patient-record facts (this
   document plus the OpenEMR chart) from guideline evidence, each claim
   carrying a 5-key citation.
4. **OpenEMR persistence** — the source document and derived facts are
   readable back from OpenEMR (a document read, and lab values through
   OpenEMR's FHIR Observation service).
5. **Dashboard / trace** — `/observability` shows the encounter's stage
   timings, token/cost totals, retrieval hits, and verification outcome for
   that same request.

**Run the eval gate and inject a regression**

```bash
git config core.hooksPath .githooks   # once per clone; this is the enforced gate (no GitLab CI runner)
npm ci --prefix agentforge
npm run eval:gate --prefix agentforge                    # 50/50 expected
npm run eval:gate --prefix agentforge -- --inject-defect  # negative control; must exit 1
```

To see the gate actually block a real change: edit a source file so an
abnormal lab flag is always reported as `normal` (for example, in
`agentforge/src/typedExtraction.js`, hardcode `abnormal_flag: 'normal'`
instead of computing it) and try to `git commit`. The pre-commit hook runs
the full suite plus the gate and refuses the commit. Revert the edit
afterward. The full, reproducible regression list (29 injected defects, all
caught) is in
[`docs/agentforge/evidence/W2_REGRESSION_MATRIX.md`](docs/agentforge/evidence/W2_REGRESSION_MATRIX.md),
re-run any time with `node agentforge/scripts/run-regression-matrix.mjs`
(it works on a scratch copy and never touches your working tree).

See [`W2_ARCHITECTURE.md`](W2_ARCHITECTURE.md) for how all of this fits
together, [`KEY_METRICS.md`](KEY_METRICS.md) for what "working" is measured
against, [`W2_COST_LATENCY.md`](W2_COST_LATENCY.md) for measured cost and
latency with production projections, and [`EVAL_GATE.md`](EVAL_GATE.md) for
the full gate rubric.

## Week 1 vs. Week 2

| | Route / service | What it does | Status |
|---|---|---|---|
| **Week 1** | `/agentforge`, service `agentforge` | Patient-scoped chart-preparation briefing: reads structured OpenEMR chart data (read-only adapter), synthesizes a pre-visit summary, verifies every clinical sentence against a source value before showing it. | Frozen at commit `84f232b`, its own pinned image (`agentforge-w1:84f232b`). Not part of this submission's changes; documented here only to distinguish it from Week 2. |
| **Week 2** | `/agentforge-w2`, service `agentforge-w2` | Everything Week 1 does, plus: document upload (lab PDF / intake form) with OCR extraction and citations, OpenEMR persistence through `oe-module-agentforge`, a supervisor + two-worker graph, hybrid guideline retrieval with rerank, a structurally-verified grounded answer, and the 50-case eval gate. | This submission. `AGENTFORGE_PERSISTENCE_MODE=openemr-module` in its compose block; Week 1's `agentforge` service is untouched and stays synthetic-only. |

Both services run from the same repository and the same OpenEMR instance;
Caddy routes `/agentforge-w2` and `/agentforge` to their separate containers,
and the bare domain to OpenEMR itself.

**Week 2 scope.** The PRD's "Core Deliverables" list mixes the core build
with extension items. We built the core five first (two document types,
supervisor plus two workers, hybrid RAG plus rerank, the 50-case gate, a
PR-blocking gate with an observable demo) and one extension (click-to-source).
The critic agent, a third document type, the lab trend chart and contextual
retrieval are in progress for the final submission.
[`W2_ARCHITECTURE.md`](W2_ARCHITECTURE.md) §2, "Scope", gives the current
state of each item.

## Local setup

Prerequisites: **Node.js 24**, and for OCR and the module tests specifically:

- **poppler** (`pdftoppm`, `pdfinfo`) and **Tesseract 5.x** on `PATH` for real
  PDF OCR. Without them, PDF-OCR-dependent tests skip (with a message)
  rather than fail; the eval gate itself still runs and passes using
  recorded OCR, so the gate does not require these tools.
- **PHP** (8.x) on `PATH` to lint and run
  `interface/modules/custom_modules/oe-module-agentforge`'s dependency-free
  test suite (`tests/run.php`). The pre-commit hook runs this automatically
  when PHP is present, or requires it only when a commit touches that
  module directory.

Install and run the service:

```bash
npm ci --prefix agentforge
AGENTFORGE_DEMO_SECRET=local-synthetic-secret AGENTFORGE_SYNTHETIC_CONTEXT=true node agentforge/src/server.js
```

```powershell
$env:AGENTFORGE_DEMO_SECRET = "local-synthetic-secret"
$env:AGENTFORGE_SYNTHETIC_CONTEXT = "true"
node agentforge/src/server.js
```

Open `http://localhost:8787/`, choose a fixture patient, prepare the
briefing, upload a sample document or run one of the built-in sample
buttons, then ask a follow-up. Locally these surfaces are `/observability`
and `/evals`; the deployed browser URLs are `/agentforge-w2/observability`
and `/agentforge-w2/evals`.

Run the tests:

```bash
npm test --prefix agentforge
npm test --prefix evals
node --test observability/test/*.test.js
node agentforge/scripts/run-w2-gate.mjs      # same as npm run eval:gate --prefix agentforge
php interface/modules/custom_modules/oe-module-agentforge/tests/run.php   # requires PHP on PATH
```

If you want the full local OpenEMR substrate this fork runs on top of
(not required to run the AgentForge service itself against fixtures), see
`docker/development-easy` in `CONTRIBUTING.md`, or the lighter
`docker/development-easy-light` compose file used for local OpenEMR UI
development:

```powershell
$env:Path = "C:\Program Files\Docker\Docker\resources\bin;" + $env:Path
$env:COMPOSE_PROJECT_NAME = "agentforge-week1"
docker compose -f docker/development-easy-light/docker-compose.yml up --detach --wait --wait-timeout 600
```

Open [http://localhost:8300](http://localhost:8300) and sign in with
`admin` / `pass`. The compose project exposes OpenEMR on 8300 (HTTP) / 9300
(HTTPS), phpMyAdmin on 8310, and MariaDB on 8320 — local development only.

## Environment variables (`agentforge-w2`)

Generated from `grep -rhoE "process\.env\.[A-Z0-9_]+" agentforge/src agentforge/scripts observability` and `deploy/vultr/docker-compose.yml`. Names only — no values, per `AGENTS.md`'s PHI rule. See
[`deploy/vultr/README.md`](deploy/vultr/README.md) for the full setup
narrative behind each group.

**Core service**

| Name | Purpose | Default | Required? | Secret? |
|---|---|---|---|---|
| `PORT` / `HOST` | Listen address | `8787` / `0.0.0.0` | No | No |
| `AGENTFORGE_PUBLIC_BASE_PATH` | URL prefix the deployed reverse proxy mounts this service under | `''` | No (Yes behind Caddy) | No |
| `AGENTFORGE_DEMO_SECRET` | Signs the synthetic demo context token | none | Yes | Yes |
| `AGENTFORGE_SYNTHETIC_CONTEXT` | Enables the fixture/demo context issuer | `false` | Yes for synthetic mode | No |
| `AGENTFORGE_MAX_REQUEST_BODY_BYTES` | Upload size cap | 8 MiB | No | No |
| `AGENTFORGE_FIXTURES` | Path to the synthetic fixture patient set | built-in path | No | No |
| `AGENTFORGE_PREPARATION_CACHE_TTL_MS` / `AGENTFORGE_FRESH_RETRIEVAL_DEADLINE_MS` / `AGENTFORGE_MAX_PREWARM_JOBS` / `AGENTFORGE_PREWARM_DEADLINE_MS` / `AGENTFORGE_RECORD_DELAY_MS` | Briefing cache and prewarm tuning (Week 1 lane, shared) | see `server.js` | No | No |
| `AGENTFORGE_SCAN_DEADLINE_MS` | End-to-end deadline for one `/v1/scan-supervisor` request (`agentforge-w2` only) | `25000` | No | No |
| `AGENTFORGE_LIVE_EXTERNAL_PROVIDER_APPROVED` | Explicit approval to let a real model see live OpenEMR chart data | `false` | No | No |
| `AGENTFORGE_TRACE_PATH` / `AGENTFORGE_TRACE_RETENTION_MS` | Redacted trace file location/retention | `/tmp/agentforge/traces.json` / 24h | No | No |
| `AGENTFORGE_EVAL_REPORT_PATH` | Overrides which committed eval report `/evals` serves | committed default | No | No |
| `AGENTFORGE_GIT_SHA` | Overrides the SHA `/health` reports | derived at build | No (Yes for `/health` proof) | No |

**Document persistence (`AGENTFORGE_PERSISTENCE_MODE=openemr-module`)**

| Name | Purpose | Default | Required? | Secret? |
|---|---|---|---|---|
| `AGENTFORGE_PERSISTENCE_MODE` | `in-memory-synthetic` (default) or `openemr-module` | `in-memory-synthetic` | No | No |
| `AGENTFORGE_OPENEMR_MODULE_URL` | Internal URL of `oe-module-agentforge`'s `api.php` | none | Yes for module mode | No |
| `AGENTFORGE_MODULE_HMAC_SECRET` | Signs every module request (HMAC-SHA-256) | none | Yes for module mode | Yes |
| `AGENTFORGE_OPENEMR_MODULE_TIMEOUT_MS` | Module request timeout | `15000` | No | No |
| `AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS` | Allowlisted OpenEMR patient UUIDs the demo may write to | none | Yes for module mode | No (contains no PHI, but treat as sensitive config) |
| `AGENTFORGE_DEMO_ACTOR_USERNAME` | OpenEMR username demo writes are attributed to | none | Yes for module mode | No |
| `AGENTFORGE_OPENEMR_DEMO_PATIENT_MAP` | Fixture-patient-id → OpenEMR patient UUID mapping | none | Yes for module mode | No |

**Live OpenEMR chart read (Week 1 lane, `AGENTFORGE_OPENEMR_MODE=live`)**

| Name | Purpose | Default | Required? | Secret? |
|---|---|---|---|---|
| `AGENTFORGE_OPENEMR_MODE` | `synthetic` (default) or `live` | `synthetic` | No | No |
| `AGENTFORGE_OPENEMR_BASE_URL` | OpenEMR base URL | none | Yes for live mode | No |
| `AGENTFORGE_OPENEMR_ACCESS_TOKEN` | Static access token (test/manual use) | none | No | Yes |
| `AGENTFORGE_OPENEMR_TOKEN_URL` / `AGENTFORGE_OPENEMR_CLIENT_ID` / `AGENTFORGE_OPENEMR_CLIENT_SECRET` | OAuth refresh-token flow for a server-only read token | none | Yes for live mode | Client secret: yes |
| `AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH` | Where the rotated refresh token is persisted | none | Yes for live mode | No (file itself is sensitive) |
| `AGENTFORGE_OPENEMR_TIMEOUT_MS` | OpenEMR HTTP call timeout | `5000` | No | No |

**Answer / synthesis model**

| Name | Purpose | Default | Required? | Secret? |
|---|---|---|---|---|
| `AGENTFORGE_PROVIDER_MODE` | `qwen` (default) or `openrouter` | `qwen` | No | No |
| `AGENTFORGE_MODEL_PROTOCOL` / `AGENTFORGE_MODEL_ENDPOINT` / `AGENTFORGE_MODEL` / `AGENTFORGE_MODEL_API_KEY` | Answer-composer and briefing-synthesis model wire | none configured by default | Yes for a real model (else deterministic-only) | API key: yes |
| `AGENTFORGE_MODEL_TIMEOUT_MS` / `AGENTFORGE_MODEL_ENABLE_THINKING` | Per-call timeout; disables Qwen extended reasoning | provider default / `false` on `agentforge-w2` | No | No |
| `AGENTFORGE_MODEL_SITE_URL` / `AGENTFORGE_MODEL_SITE_NAME` | Attribution headers some providers require | none / `AgentForge` | No | No |
| `AGENTFORGE_OPENROUTER_ENDPOINT` / `AGENTFORGE_OPENROUTER_MODEL` / `AGENTFORGE_OPENROUTER_API_KEY` / `AGENTFORGE_OPENROUTER_TIMEOUT_MS` | OpenRouter provider lane (alternative to Qwen) | none | Only if `AGENTFORGE_PROVIDER_MODE=openrouter` | API key: yes |
| `AGENTFORGE_CONVERSATION_PROVIDER_MODE` / `AGENTFORGE_CONVERSATION_OPENROUTER_*` | Separate short-follow-up conversation lane | none | No | API key: yes |

**Guideline RAG (hybrid retrieval + rerank)**

| Name | Purpose | Default | Required? | Secret? |
|---|---|---|---|---|
| `AGENTFORGE_RAG_PROVIDER` | `local-lexical` (BM25-only, Week 1 default) or `gemini-hybrid` (`agentforge-w2` default) | `local-lexical` | No | No |
| `GEMINI_API_KEY` | Dense embeddings (`gemini-embedding-2`) | none | Yes for hybrid retrieval | Yes |
| `AGENTFORGE_RERANK_PROVIDER` | `qwen` (default), `gemini`, or `cohere` | `qwen` | No | No |
| `AGENTFORGE_RERANK_MODEL` / `AGENTFORGE_RERANK_TIMEOUT_MS` | Rerank model and timeout | `qwen3.8-flash` / `6000` | No | No |
| `AGENTFORGE_COHERE_API_KEY` | Only if `AGENTFORGE_RERANK_PROVIDER=cohere` | none | No (not the deployed default) | Yes |

**Optional Gemini scan-extraction lane** (off by default; `AGENTFORGE_SCAN_PROVIDER_MODE=local` is the deployed default and does not use these)

| Name | Purpose | Default | Required? | Secret? |
|---|---|---|---|---|
| `AGENTFORGE_SCAN_PROVIDER_MODE` | `local` (Tesseract, default) or `gemini` | `local` | No | No |
| `AGENTFORGE_GEMINI_SCAN_MODEL` / `AGENTFORGE_GEMINI_SCAN_TIMEOUT_MS` / `AGENTFORGE_GEMINI_SCAN_DAILY_LIMIT` | Gemini scan-extraction tuning | `gemini-3.8-flash` / `45000` / `12` | No | No |

**Observability**

| Name | Purpose | Default | Required? | Secret? |
|---|---|---|---|---|
| `AGENTFORGE_ALERT_P95_MS` / `AGENTFORGE_ALERT_ERROR_RATE` / `AGENTFORGE_ALERT_TOOL_FAILURE_RATE` / `AGENTFORGE_ALERT_WINDOW_MS` | Dashboard alert thresholds | `2000` / `0.05` / `0.02` / 5 min | No | No |
| `LANGFUSE_BASE_URL` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_TIMEOUT_MS` / `LANGFUSE_MAX_PENDING_EXPORTS` | Optional self-hosted Langfuse export (all three of the first must be set together) | disabled | No | Secret key: yes |

**Test-only** (never set in a deployed environment): `AGENTFORGE_TEST_CLINICAL_ACTION_FAILURE`, `AGENTFORGE_TEST_INVALID_ANSWER`, `AGENTFORGE_TEST_INVALID_SCAN_EXTRACTION`, `AGENTFORGE_TEST_SOURCE_DOCUMENT_FAILURE` — force specific failure paths in tests.

### Contributing

OpenEMR is a leader in healthcare open source software and comprises a large and diverse community of software developers, medical providers and educators with a very healthy mix of both volunteers and professionals. [Join us and learn how to start contributing today!](https://open-emr.org/wiki/index.php/FAQ#How_do_I_begin_to_volunteer_for_the_OpenEMR_project.3F)

> Already comfortable with git? Check out [CONTRIBUTING.md](CONTRIBUTING.md) for quick setup instructions and requirements for contributing to OpenEMR by resolving a bug or adding an awesome feature 😊.

### Support

Community and Professional support can be found [here](https://open-emr.org/wiki/index.php/OpenEMR_Support_Guide).

Extensive documentation and forums can be found on the [OpenEMR website](https://open-emr.org) that can help you to become more familiar about the project 📖.

### Reporting Issues and Bugs

Report these on the [Issue Tracker](https://github.com/openemr/openemr/issues). If you are unsure if it is an issue/bug, then always feel free to use the [Forum](https://community.open-emr.org/) and [Chat](https://www.open-emr.org/chat/) to discuss about the issue 🪲.

### Reporting Security Vulnerabilities

Check out [SECURITY.md](.github/SECURITY.md)

### API

Check out [API_README.md](API_README.md)

### Docker

Check out [DOCKER_README.md](DOCKER_README.md)

### FHIR

Check out [FHIR_README.md](FHIR_README.md)

### For Developers

If using OpenEMR directly from the code repository, then the following commands will build OpenEMR (Node.js version 24.* is required) :

```shell
composer install --no-dev
npm install
npm run build
composer dump-autoload -o
```

### Contributors

This project exists thanks to all the people who have contributed. [[Contribute]](CONTRIBUTING.md).
<a href="https://github.com/openemr/openemr/graphs/contributors"><img src="https://opencollective.com/openemr/contributors.svg?width=890" /></a>


### Sponsors

Thanks to our [ONC Certification Major Sponsors](https://www.open-emr.org/wiki/index.php/OpenEMR_Certification_Stage_III_Meaningful_Use#Major_sponsors)!


### License

[GNU GPL](LICENSE)
