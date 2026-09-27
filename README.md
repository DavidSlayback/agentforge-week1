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

Grader credentials for the OpenEMR and dashboard sign-in are in the
submission notes, not in this repo.

**Patient dashboard port (W2 surprise challenge).** A React SPA with a BFF that
reimplements OpenEMR's PHP patient dashboard on its REST/FHIR API. It runs at
<https://dtstest.64.177.10.182.nip.io/dashboard/> (deployed SHA:
`/dashboard/health`). Sign in, then open demo patient MRN `DASH-SYN-01`
(data-rich) or `DASH-SYN-02` (deceased). The defense is in
[`PATIENT_DASHBOARD_MIGRATION.md`](PATIENT_DASHBOARD_MIGRATION.md), and the
code is in [`dashboard/`](dashboard/README.md).

**Sample documents.** Seven synthetic filled PDFs exercise the three document
types (lab report, intake form, medication list) and both OCR layouts — a
vector-text layout and a rasterized-page layout that exercises real OCR over
pixels. Lab C is the same patient at an earlier date, for the lab trend:

- [`docs/agentforge/fixtures/scan-forms/pdf-samples/filled-lab-a.pdf`](docs/agentforge/fixtures/scan-forms/pdf-samples/filled-lab-a.pdf)
- [`docs/agentforge/fixtures/scan-forms/pdf-samples/filled-lab-b.pdf`](docs/agentforge/fixtures/scan-forms/pdf-samples/filled-lab-b.pdf)
- [`docs/agentforge/fixtures/scan-forms/pdf-samples/filled-lab-c.pdf`](docs/agentforge/fixtures/scan-forms/pdf-samples/filled-lab-c.pdf)
- [`docs/agentforge/fixtures/scan-forms/pdf-samples/filled-intake-a.pdf`](docs/agentforge/fixtures/scan-forms/pdf-samples/filled-intake-a.pdf)
- [`docs/agentforge/fixtures/scan-forms/pdf-samples/filled-intake-b.pdf`](docs/agentforge/fixtures/scan-forms/pdf-samples/filled-intake-b.pdf)
- [`docs/agentforge/fixtures/scan-forms/pdf-samples/filled-medlist-a.pdf`](docs/agentforge/fixtures/scan-forms/pdf-samples/filled-medlist-a.pdf)
- [`docs/agentforge/fixtures/scan-forms/pdf-samples/filled-medlist-b.pdf`](docs/agentforge/fixtures/scan-forms/pdf-samples/filled-medlist-b.pdf)

The deployed UI's home page has a "Run this sample" button and a download
link for each of the seven, so a grader never has to find these files on
disk to try the flow.

**Where to see each extension item** (all on the W2 URL; the SHA each was
observed on is in [`W2_ARCHITECTURE.md`](W2_ARCHITECTURE.md) §2):

- **Critic agent:** run any sample. The result reads "Scan workers: …
  → critic-worker" and the answer heading says "critic: reviewed" (or
  `disabled` / `skipped_budget` / `failed` when it did not review). The trace
  in `/observability` shows the `CRITIQUE` decision.
- **Third document type:** "Medication list · Layout A" or "Layout B" →
  "Run this sample".
- **Lab trend chart:** run "Lab result · Layout A", then "Layout C". Below
  the lab result, "Lab trends" shows one chart per test with a point per
  uploaded lab, read back from OpenEMR's FHIR Observation service. Each
  point links to its source document.
- **Click-to-source:** after a scan, "Open source preview", then any "View
  source region" link; the cited box on the page image is highlighted.
- **Contextual retrieval:** not visible on the public URL, because it only
  changes BM25-alone ranking (the `sparse_only` fallback). See it offline
  with `node agentforge/scripts/benchmark-retrieval.mjs`.

**5-step demo**

1. **Upload** one of the seven sample PDFs (or your own PDF/`.scan.txt` test
   envelope) against a seeded synthetic patient.
2. **Overlay preview** — the rendered page shows a bounding box per extracted
   field; clicking a citation in the answer scrolls to and highlights its box.
3. **Grounded answer** — the response separates patient-record facts (this
   document plus the chart) from guideline evidence, each claim carrying a
   5-key citation. On the public demo the chart is a synthetic fixture, and
   its facts are labeled "Synthetic chart fixture". A critic model then
   reviews the claims and can only remove them.
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
npm run eval:extensions --prefix agentforge              # extension suite (critic, medication list, trend, click-to-source, retrieval)
```

`.githooks/pre-push` runs both gates before any push, so a regression blocks
a push, not only a commit.

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
| **Week 1** | `/agentforge`, service `agentforge` | Patient-scoped chart-preparation briefing and follow-up. Reads the chart from synthetic fixtures (`AGENTFORGE_OPENEMR_MODE=synthetic`), not from OpenEMR. | Frozen snapshot of the W1 submission at `84f232b` (pinned image `agentforge-w1:84f232b`, never rebuilt). It keeps its known debt, including the `.some` verifier and $0 cost; see [`W2_ARCHITECTURE.md`](W2_ARCHITECTURE.md) §4, "Week 1 debt". Superseded by Week 2. |
| **Week 2** | `/agentforge-w2`, service `agentforge-w2` | The briefing and follow-up on the W2 code, with the Week 1 trust fixes (per-sentence verifier, no answer-key reads, other-patient questions refused). Plus: document upload (lab PDF, intake form, medication list) with OCR extraction and 5-key citations; OpenEMR persistence of the document, derived facts and lab rows through `oe-module-agentforge`; a supervisor with extraction, evidence-retrieval and critic workers; hybrid guideline retrieval with rerank; a structurally verified grounded answer; a lab trend chart read back from OpenEMR; click-to-source on the page image; the 50-case eval gate and the extension suite. On the public no-login demo, chart facts come from synthetic fixtures and are labeled "Synthetic chart fixture". An OpenEMR-launched session (E9) reads the real chart for the designated synthetic patient `AF-LIVE-01` (observed on `b942391f`); problems and allergies stay unconfirmed there until a clinician re-authorizes the read client (`W2_ARCHITECTURE.md` §3f). | This submission, frozen at tag `w2-final` (`d5a0df7e`). `/health` reports the deployed SHA. `AGENTFORGE_PERSISTENCE_MODE=openemr-module` in its compose block. |

Both services run on the same VM as OpenEMR, from the same repository (W1 as
a pinned image). Caddy routes `/agentforge-w2` and `/agentforge` to their separate containers,
and the bare domain to OpenEMR itself.

**Week 2 scope.** The PRD's "Core Deliverables" list mixes the core build
with extension items. We built the core five first (two document types,
supervisor plus two workers, hybrid RAG plus rerank, the 50-case gate, a
PR-blocking gate with an observable demo), then all five extensions (PLAN
D12): the critic agent, click-to-source, the `medication_list` type, the lab
trend chart and contextual retrieval (query expansion, which applies only to
the BM25 fallback). Every item is built and deployed.
[`W2_ARCHITECTURE.md`](W2_ARCHITECTURE.md) §2, "Scope", gives each item's
state with the SHA it was observed on and its evidence. The release freeze
is tag `w2-final` (`d5a0df7e`), deployed to `/agentforge-w2` and `/dashboard`
on 2026-09-27 at about 02:10 UTC; `main` is ahead only by evidence and docs
commits. Live acceptance passed 26/26 on it
([`docs/agentforge/evidence/LEDGER.md`](docs/agentforge/evidence/LEDGER.md)).

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

API collection (Bruno, every W1 and W2 endpoint; see `agentforge/api/README.md`):

```bash
cd agentforge/api/bruno && npx @usebruno/cli run --env deployed   # the public URL; makes one model-costing scan
node agentforge/scripts/run-bruno-local.mjs                        # a local server from this checkout, no model calls
```

Load test (10 and 50 concurrent users; method, cost and the freeze-run
commands are in `docs/agentforge/LOAD_TEST.md`):

```bash
node agentforge/scripts/load-test.mjs --dry-run
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
| `AGENTFORGE_LIVE_EXTERNAL_PROVIDER_APPROVED` | Explicit approval to let external services (answer model, critic, embed/rerank, external OCR) see a live OpenEMR read (live mode, and `AGENTFORGE_OPENEMR_LIVE_READS=on` requests). Without it such a request makes no outbound call | `false` | No | No |
| `AGENTFORGE_TRACE_PATH` / `AGENTFORGE_TRACE_RETENTION_MS` | Redacted trace file location/retention. The `agentforge-w2` compose service writes `/data/w2-traces.json` on the `w2tracevolume` named volume and keeps 7 days (`AGENTFORGE_W2_TRACE_RETENTION_MS`), so traces survive a redeploy | `/tmp/agentforge/traces.json` / 24h | No | No |
| `AGENTFORGE_TRACE_LIMIT` | Most traces the store keeps (oldest dropped first); `/v1/traces` and `/observability` show all retained traces, so this is their cap. Must be a positive integer or the process exits. `agentforge-w2` reads it from `AGENTFORGE_W2_TRACE_LIMIT` | `500` | No | No |
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
| `AGENTFORGE_SERVICE_URL` | `openemr` container: where the "Prepare for visit" launcher link points. Production: the public W2 path, `https://<host>/agentforge-w2` (the browser follows it) | `http://127.0.0.1:8787` | Yes in Compose | No |

**Live OpenEMR chart read.** `AGENTFORGE_OPENEMR_MODE=live` reads every request from OpenEMR (Week 1 lane). In the synthetic mode, `AGENTFORGE_OPENEMR_LIVE_READS=on` reads OpenEMR only for requests whose verified token was minted by the OpenEMR launcher (`agentforge-w2`, `W2_ARCHITECTURE.md` §3f); the rows below then apply to it as well.

| Name | Purpose | Default | Required? | Secret? |
|---|---|---|---|---|
| `AGENTFORGE_OPENEMR_MODE` | `synthetic` (default) or `live` | `synthetic` | No | No |
| `AGENTFORGE_LIVE_PATIENT_UUIDS` | The designated synthetic patients (on `openemr` and `agentforge-w2`): the launcher mints live tokens only for them, and external egress from a live read needs one of them plus `AGENTFORGE_LIVE_EXTERNAL_PROVIDER_APPROVED` | empty (nobody) | Yes for live reads | No |
| `AGENTFORGE_OPENEMR_LIVE_READS` | `on` or `off`. Synthetic mode only: `on` reads the real chart for OpenEMR-launcher tokens (issuer `openemr-module`, authn `openemr-session`); `off` refuses them with `openemr_live_reads_disabled`, never a fixture fallback. Any other value stops startup | `off` | No | No |
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
| `AGENTFORGE_CRITIC_PROVIDER` | Critic lane for `/v1/scan-supervisor` answers (`agentforge-w2`): an LLM that can only veto claims. `openrouter` is the only value | `openrouter` | No | No |
| `AGENTFORGE_CRITIC_MODEL` | OpenRouter model id for the critic. No default: unset means the critic is disabled and every answer says `critic_status: disabled`. Uses `AGENTFORGE_OPENROUTER_ENDPOINT` / `AGENTFORGE_OPENROUTER_API_KEY` | none | No | No |
| `AGENTFORGE_CRITIC_TIMEOUT_MS` | Critic call timeout. The critic runs only if the scan deadline leaves at least this much time; otherwise `critic_status: skipped_budget` | `4000` | No | No |

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
| `AGENTFORGE_ALERT_P95_MS` / `AGENTFORGE_ALERT_ERROR_RATE` / `AGENTFORGE_ALERT_TOOL_FAILURE_RATE` / `AGENTFORGE_ALERT_WINDOW_MS` | Dashboard alert thresholds | `2000` / `0.05` / `0.02` / 5 min; the `agentforge-w2` compose service sets `AGENTFORGE_ALERT_P95_MS=30000` (the `KEY_METRICS.md` p95 target; override with `AGENTFORGE_W2_ALERT_P95_MS`) | No | No |
| `AGENTFORGE_ALERT_EVAL_INTERVAL_MS` | How often the server evaluates the alert rules in the background (also on every `GET /v1/alerts`). Each rule's `ok`/`firing` change is logged once, as one JSON line with codes only (`agentforge_alert_transition`, rule id, states, window). Must be a positive integer | `60000` | No | No |
| `LANGFUSE_BASE_URL` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` / `LANGFUSE_TIMEOUT_MS` / `LANGFUSE_MAX_PENDING_EXPORTS` | Optional self-hosted Langfuse export (all three of the first must be set together). When set, `/ready` also probes `GET <base>/api/public/health` and reports `langfuse` | disabled | No | Secret key: yes |

`/ready` answers 503 and lists the failing dependency names in `failing`,
with a `reason` code where one is known. It checks the configuration, the
chart source, the model, the trace store (`traceStore`: its state plus a real
write), the guideline corpus, the OpenEMR module's signed `health` route when
`AGENTFORGE_PERSISTENCE_MODE=openemr-module` (`openemrModule`, reason = the
module error code), and Langfuse when it is configured. The write, module and
Langfuse probes are cached for 30 s, and concurrent `/ready` calls share one
in-flight probe. A trace file that does not parse at startup is renamed to
`<name>.corrupt-<ms>.json`, the store starts empty, one
`agentforge_trace_store_recovered` line is logged, and `traceStore` reports
`TRACE_STORE_CORRUPT` until the next trace is written.

Every response carries an `x-correlation-id` header. A caller's value is used
only when it is a UUID or 16-64 lowercase hex characters; anything else is
dropped (not logged, stored or forwarded) and the server mints `af-<uuid>`.
The id names the scan trace, is sent on every outbound call the request makes
(OpenEMR REST reads and token refresh, guideline embed and rerank, OpenEMR
module), and appears in the server's error logs.

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
