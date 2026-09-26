# Vultr deployment

This Compose file is suitable for the public synthetic AgentForge checkpoint
demonstration only. It is not approved for real patient data.

The owner-controlled VM's host, SSH user and key are kept out of the
repository (see `deploy.sh` for the environment variables it needs). The remote
deployment root is `/opt/agentforge-week1`; its mode-600 `.env` is stored at
that root and is not part of the repository. The Compose file is under
`deploy/vultr/`; when running Compose from that directory, pass the root env
file explicitly with `--env-file /opt/agentforge-week1/.env`.

The Week 1 `agentforge` service is frozen (PLAN D8). It runs the VM-local image
tag `agentforge-w1:84f232b`, taken from the running W1 container, and has no
`build:` section, so no `docker compose build` or `up --build` can rebuild it
from Week 2 sources. `deploy.sh` ships only `agentforge-w2` by default. To
change W1 deliberately, build and tag a new image and update the `image:` line.

## What `deploy.sh` does

1. **Refuses** a dirty tree, or a commit not on `staging/main` unless
   `AGENTFORGE_DEPLOY_ALLOW_UNMERGED=1`.
2. **Backs up** the current sources on the VM to
   `~/agentforge-week1-backups/<stamp>/`.
3. **Ships** the committed tree with `git archive`.
4. **Fixes** the module's permissions.
5. **Recreates** the proxy if the Caddyfile changed.
6. **Builds and replaces** the named services. This step is hardened against
   the 2026-09-26 incident, in which the SSH session reset during
   `up -d --build` and left the dashboard container removed, with about
   10 minutes of 502:
   - **Build first, then replace.** A runner on the VM runs
     `docker compose build <services>`, then `up -d --no-deps <services>` only
     if every build succeeded. A failed build leaves the running containers
     untouched and fails the deploy.
   - **Detached from SSH.** The runner starts under `setsid nohup` (plain
     `nohup` if `setsid` is missing). Its log, exit marker and script live in
     `/tmp/agentforge-deploy-<stamp>/` (`build.log`, `exit`, `build.sh`).
     `deploy.sh` polls it every 10 s with short SSH calls. A dropped session,
     a failed launch call, or up to 29 failed status checks in a row do not
     stop the build. The deploy fails if:
     - the runner never started;
     - 30 checks in a row fail;
     - the build is still running after 40 min;
     - the runner reports a non-zero status. `deploy.sh` then prints the log's
       last 40 lines.
   - **Keepalives.** Every SSH call uses `ServerAliveInterval=15`,
     `ServerAliveCountMax=8` and `ConnectTimeout=20`.
7. **Succeeds only when** each deployed service's `/health` reports the
   deployed SHA on the public URL. This check is unchanged.

To follow a build by hand:
`ssh <host> tail -f /tmp/agentforge-deploy-<stamp>/build.log`.

Offline tests cover these behaviors with fake `ssh`, `docker` and `curl`:
`sh deploy/vultr/test/deploy.test.sh`. They are run by `.githooks/pre-commit`
and mirrored by the `deploy-script` job in `.gitlab-ci.yml`. They cannot show
that `setsid`/`nohup` survive a real SSH reset on the VM. The next real deploy
is the first observation of that.

## Required secrets

Create a server-only `.env` at `/opt/agentforge-week1/.env`:

```dotenv
MYSQL_ROOT_PASSWORD=<long-random-value>
MYSQL_USER=openemr
MYSQL_PASSWORD=<long-random-value>
OE_USER=admin
OE_PASSWORD=<long-random-value>
AGENTFORGE_DEMO_SECRET=<long-random-value>
AGENTFORGE_OPENEMR_MODE=live
AGENTFORGE_SERVICE_URL=https://<canonical-host>/agentforge
AGENTFORGE_OPENEMR_BASE_URL=http://openemr
AGENTFORGE_OPENEMR_TOKEN_URL=https://<canonical-host>/oauth2/default/token
AGENTFORGE_OPENEMR_CLIENT_ID=<server-only-read-client-id>
AGENTFORGE_OPENEMR_CLIENT_SECRET=<server-only-read-client-secret>
AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH=/run/secrets/agentforge-openemr-token.json
```

Do not commit this file. Keep `secrets/openemr-token.json` root-only and
server-side; AgentForge refreshes the short-lived OpenEMR access token and
persists rotation of the refresh token there. From
`/opt/agentforge-week1/deploy/vultr`, start with
`docker compose --env-file /opt/agentforge-week1/.env up -d --build` and verify
OpenEMR readiness and AgentForge readiness before using the instance.

AgentForge is a separate service beside OpenEMR. Caddy owns the public 80/443
entrypoints and routes `/agentforge` to the service while routing the root path
to OpenEMR. The module launcher reads the selected OpenEMR patient's UUID from
the authenticated session's `pid` and creates a signed context (280 s). The
AgentForge service then uses the allowlisted OpenEMR REST read routes with a
server-only OAuth access token. The token must be provisioned through the
approved OpenEMR OAuth client path; missing or invalid authorization keeps live
mode not ready. The fixture/demo context issuer is disabled in live mode.
Set `AGENTFORGE_OPENEMR_MODE=live` explicitly for that path. The default Compose
mode is `synthetic`; it requires `AGENTFORGE_SYNTHETIC_CONTEXT=true` and a
non-empty `AGENTFORGE_DEMO_SECRET` before `/ready` can report ready.

## Week 2 OpenEMR round-trip (oe-module-agentforge)

The `agentforge-w2` service keeps the synthetic fixture chart but persists
uploads in OpenEMR (`AGENTFORGE_PERSISTENCE_MODE=openemr-module`, set in
Compose). It calls the module's internal endpoint
`http://openemr/interface/modules/custom_modules/oe-module-agentforge/public/api.php`
over the Docker network; Caddy answers 404 publicly for everything under the
module directory except the Week 1 launcher `public/index.php`. Every call is
HMAC-signed with a key derived from `AGENTFORGE_MODULE_HMAC_SECRET` (held only
by `openemr` and `agentforge-w2`, never by the Week 1 `agentforge` service) and
carries a context token signed with `AGENTFORGE_DEMO_SECRET`; the module takes
the acting OpenEMR user from that token and accepts only allowlisted patients,
whatever the token's issuer. Writes need a write-scoped token. Lab rows are
stored as preliminary (`prelim`) pending clinician review. The Week 1
`agentforge` service is unchanged and stays in synthetic mode.

**Add these to `/opt/agentforge-week1/.env` before running any `docker compose`
command** (including `ps`, `logs` or `up` for an unrelated service): Compose
interpolates the whole file, and the `:?` guards stop every command while one
is missing.

```dotenv
# Long random value, different from AGENTFORGE_DEMO_SECRET (openemr + agentforge-w2)
AGENTFORGE_MODULE_HMAC_SECRET=<long-random-value>
# OpenEMR patient uuids the public synthetic demo may write to (openemr + agentforge-w2)
AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS=<openemr-patient-uuid>[,<uuid>...]
# OpenEMR username demo writes are attributed to (openemr)
AGENTFORGE_DEMO_ACTOR_USERNAME=<openemr-username>
# Fixture patient -> allowlisted OpenEMR patient uuid (agentforge-w2)
AGENTFORGE_OPENEMR_DEMO_PATIENT_MAP=fixture-patient-001=<openemr-patient-uuid>
# Optional, default 15000 (agentforge-w2)
AGENTFORGE_OPENEMR_MODULE_TIMEOUT_MS=15000
```

Install the module's tables once (idempotent) and recreate `openemr` so it sees
the new env: `AGENTFORGE_DEPLOY_APPLY_MODULE_SQL=1
AGENTFORGE_DEPLOY_RECREATE_OPENEMR=1 deploy/vultr/deploy.sh`. Until the tables
exist the endpoint answers 503 `ledger_not_installed`. `deploy.sh` recreates
the proxy when the Caddyfile changed. After a deploy, run
`agentforge/scripts/w2-openemr-smoke.mjs` (see its header) to prove the
round-trip on the public URL.

Lab read-back uses OpenEMR's FHIR Observation service in-process
(`read_path: openemr-fhir-service-in-process`), not the `/fhir` HTTP API. That
API was enabled on 2026-09-25 for the patient dashboard port; this proof does
not use it.

## Week 2 live chart reads from an OpenEMR session (E9)

`agentforge-w2` keeps `AGENTFORGE_OPENEMR_MODE: synthetic`, so the public demo
still reads the fixture chart. A page opened from the OpenEMR patient menu item
"Prepare for visit" carries tokens minted by the module launcher
(`oe-module-agentforge/public/index.php`: issuer `openemr-module`, authn
`openemr-session`, 280 s). For those requests only, the service reads the real
chart through the OpenEMR REST API when `AGENTFORGE_OPENEMR_LIVE_READS=on`
(`W2_ARCHITECTURE.md` §3f). With `off` (the default) they are refused with
`openemr_live_reads_disabled`, never served from fixtures.

New `agentforge-w2` settings (Compose passes them through; defaults in
parentheses):

| Variable | Purpose |
|---|---|
| `AGENTFORGE_OPENEMR_LIVE_READS` (`off`) | `on` reads OpenEMR for launcher tokens; any value other than `on`/`off` stops startup |
| `AGENTFORGE_OPENEMR_BASE_URL` (`http://openemr`) | REST base, over the Docker network |
| `AGENTFORGE_OPENEMR_TOKEN_URL`, `AGENTFORGE_OPENEMR_CLIENT_ID`, `AGENTFORGE_OPENEMR_CLIENT_SECRET` (empty) | The server-only read client that owns the refresh token (the same values Week 1's live mode uses) |
| `AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH` (fixed) | `/run/secrets/agentforge-openemr-token.json`, mounted from `secrets/openemr-token.json` |
| `AGENTFORGE_OPENEMR_TIMEOUT_MS` (`5000`) | REST call timeout |
| `AGENTFORGE_LIVE_EXTERNAL_PROVIDER_APPROVED` (`false`) | `true` lets a live read of a designated patient use the external services (Qwen answer and rerank, the OpenRouter critic, Gemini embeddings and OCR). Otherwise a live read makes no outbound call: deterministic answer, critic `skipped_not_approved`, local BM25 retrieval, and a live briefing is blocked |
| `AGENTFORGE_LIVE_PATIENT_UUIDS` (empty) | The designated synthetic patients, on **both** `openemr` and `agentforge-w2`. The launcher mints live tokens only for these (anyone else gets a 403), and the approval above applies only to them. Empty means nobody |

On the `openemr` service, `AGENTFORGE_SERVICE_URL` is where the launcher link
points. For W2 it must be the public W2 path: `https://<canonical-host>/agentforge-w2`.

### Operator runbook

Steps 1, 2 and 5 run on the VM from `/opt/agentforge-week1/deploy/vultr`;
step 4 runs `deploy.sh` from the repo root on the workstation, on the freeze
SHA. Values are never printed.

1. **Check that Week 1 does not use the token file.** Both services mount
   `secrets/openemr-token.json`, and a refresh rotates the refresh token, so
   only one service may use it: `docker compose --env-file
   /opt/agentforge-week1/.env exec agentforge printenv AGENTFORGE_OPENEMR_MODE`
   must print `synthetic` (or nothing). If it prints `live`, stop and ask.
2. **Seed the synthetic patient** (idempotent; a second run prints `ALREADY
   SEEDED`):
   ```sh
   docker compose --env-file /opt/agentforge-week1/.env exec -T mysql \
     sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb -uroot openemr' < seed/agentforge-live-chart-seed.sql
   ```
   The last result row is `AF-LIVE-01` with its `patient_uuid`. Run
   `seed/agentforge-live-chart-check.sql` the same way to see the rows (and
   that `grader` has a `users.uuid`). `seed/agentforge-live-chart-unseed.sql`
   removes exactly the marked rows.
3. **Set the env** in `/opt/agentforge-week1/.env`:
   ```dotenv
   AGENTFORGE_SERVICE_URL=https://<canonical-host>/agentforge-w2
   AGENTFORGE_OPENEMR_LIVE_READS=on
   # the designated synthetic patients: the launcher refuses everyone else
   AGENTFORGE_LIVE_PATIENT_UUIDS=<af-live-01-patient-uuid>
   # append the seeded uuid; keep the existing entries (uploads)
   AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS=<existing-uuids>,<af-live-01-patient-uuid>
   AGENTFORGE_OPENEMR_TOKEN_URL=https://<canonical-host>/oauth2/default/token
   AGENTFORGE_OPENEMR_CLIENT_ID=<server-only-read-client-id>
   AGENTFORGE_OPENEMR_CLIENT_SECRET=<server-only-read-client-secret>
   # optional: let the external models (answer, critic, embed/rerank, OCR)
   # see the designated synthetic patient's live chart; leave unset to keep
   # every live read in-process
   AGENTFORGE_LIVE_EXTERNAL_PROVIDER_APPROVED=true
   ```
   (`AGENTFORGE_OPENEMR_BASE_URL` defaults to `http://openemr`.) If live
   reads are on but these OpenEMR settings are missing, `agentforge-w2` logs
   the missing names, `/ready` stays 503 and live requests are refused with
   `openemr_live_reads_not_configured`. `grader` needs read access to
   `patients/demo`, `patients/med`, `patients/docs`, `encounters/notes` and
   `encounters/auth_a` (and `patients/docs` write for uploads).
4. **Recreate the containers** so they see the env: `agentforge-w2` (deploy)
   and `openemr` (changed `AGENTFORGE_SERVICE_URL` and allowlist):
   `AGENTFORGE_DEPLOY_RECREATE_OPENEMR=1 AGENTFORGE_DEPLOY_SERVICES="dashboard agentforge-w2" deploy/vultr/deploy.sh`
   (drop `dashboard` if only W2 changed).
5. **Check the OAuth refresh token.** `curl -s https://<canonical-host>/agentforge-w2/ready`
   must answer 200 with `retrieval` ready: with live reads on, that check
   includes an authenticated `GET /apis/default/api/patient?limit=1`. A 503
   there means the refresh token or client is not valid; the fix is a new
   authorization through the read client, not turning live reads off
   silently.
6. **Observe as `grader`.** Sign in to OpenEMR, open patient
   `Test Patient One` (pubpid `AF-LIVE-01`), choose **Prepare for visit** in
   the patient menu and open the link within about 4 minutes. The page badge
   must say "Chart source: OpenEMR (live)". Run the "Lab result · Layout A"
   sample: the scan answer's patient-record facts cite `openemr_record`
   (Hypertension, Lisinopril, Penicillin, the blood-pressure follow-up
   encounter), the badge stays "OpenEMR (live)", and "View source region"
   opens the stored PDF. `/agentforge-w2/v1/traces` shows the scan's retrieval
   attempts with `adapter: openemr`. The public demo at `/agentforge-w2/`
   must still say "Chart source: synthetic fixture". If the launcher says
   "Chart reads only", `grader` lacks `patients/docs` write or the uuid is not
   on the write allowlist; "enabled only for designated synthetic patients"
   means the uuid is not on `AGENTFORGE_LIVE_PATIENT_UUIDS` (or `openemr`
   was not recreated after the change). The page header must say "Live
   OpenEMR chart (synthetic patient)", and the address bar must not show the
   token after the page loads.

Known gaps on the live path: medication rows carry no dose (the fact reads
`active` or `ended <date>`), and the document route returns 404 without a
`path`, so the briefing is qualified with `notes:failed`.

## Patient dashboard port (`dashboard`)

The `dashboard` service (`dashboard/Dockerfile`) serves the React SPA and its
Fastify BFF at `/dashboard/` (Caddy `handle /dashboard/*`, all three site
blocks). The BFF is a confidential OAuth client of this OpenEMR; tokens and the
client secret stay in the container. It is not in `proxy.depends_on`, so a
failing dashboard returns 502 on `/dashboard/*` only.

**Prerequisite for every deploy once this Compose file is on the VM:** the
`DASHBOARD_*` variables marked required below use `${VAR:?}`, and Compose
refuses to interpolate the file (for any service) while one is missing. Add
them to `/opt/agentforge-week1/.env` before the next `deploy.sh` run.

```dotenv
# Browser-facing origin, no path (the redirect URI is <origin>/dashboard/callback)
DASHBOARD_PUBLIC_ORIGIN=https://<canonical-host>
# OpenEMR issuer exactly as its id tokens' iss: <site_addr_oath>/oauth2/default
DASHBOARD_OAUTH_ISSUER=https://<canonical-host>/oauth2/default
# Confidential client "AgentForge Dashboard" registered on this OpenEMR with
# redirect https://<canonical-host>/dashboard/callback, ONE post-logout URI
# https://<canonical-host>/dashboard/, and the scope string in
# dashboard/bff/src/config.ts (OAUTH_SCOPE); then enabled.
DASHBOARD_OAUTH_CLIENT_ID=<client-id>
DASHBOARD_OAUTH_CLIENT_SECRET=<client-secret>
# At least 32 random characters
DASHBOARD_SESSION_SECRET=<long-random-value>
# Optional (defaults shown or empty)
DASHBOARD_OPENEMR_INTERNAL_URL=http://openemr
DASHBOARD_OPENEMR_TZ=America/Chicago
DASHBOARD_DEMO_PATIENTS=Demo A (data-rich)=<patient-uuid>,Demo B (deceased)=<patient-uuid>
```

Ship it with `AGENTFORGE_DEPLOY_SERVICES="dashboard" sh deploy/vultr/deploy.sh`
(only from a commit on `staging/main`); the health loop then requires
`/dashboard/health` to report the deployed SHA. Afterwards run the
unauthenticated checks: `node dashboard/scripts/live-check.mjs
"$AGENTFORGE_PUBLIC_URL" "$(git rev-parse HEAD)"`. The server-side `/token` and
JWKS calls go to `DASHBOARD_OPENEMR_INTERNAL_URL` while the browser authorizes
against the public origin (risk R-3 in `MIGRATION-REACT.md`); if OpenEMR
rejects that split, point `DASHBOARD_OPENEMR_INTERNAL_URL` at the public origin.

## Optional synthetic live-provider lane

The deterministic provider remains the local/default fallback. Historical
owner-authorized deployment evidence records a synthetic evaluation lane using Alibaba Model Studio
`qwen3.6-flash`; configure these server-only values in the root-only `.env`
file and redeploy only the AgentForge service. This lane is not PHI approval.

```dotenv
AGENTFORGE_MODEL_PROTOCOL=responses
AGENTFORGE_MODEL_ENDPOINT=https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/responses
AGENTFORGE_MODEL=qwen3.6-flash
AGENTFORGE_MODEL_API_KEY=<server-only-model-studio-key>
AGENTFORGE_MODEL_SITE_URL=https://<canonical-host>/agentforge
AGENTFORGE_MODEL_SITE_NAME=AgentForge
AGENTFORGE_MODEL_TIMEOUT_MS=8000
```

`AGENTFORGE_SCAN_DEADLINE_MS` (default 25000, `agentforge-w2` only) bounds one
`/v1/scan-supervisor` request end to end: its `AbortSignal` is shared by the
low-confidence OCR retry and the answer composer's model call, so a slow
retry or a slow model cannot hang the request past this budget. Once it
fires, the OCR retry is skipped (the original extraction is kept) and the
answer is composed deterministically (`workflow.answer.model_rejected_reason:
"deadline"`), never left hanging.

The E2 critic (`agentforge-w2` only) is an LLM that can only veto answer
claims. It uses the OpenRouter key and endpoint above (now also passed to
`agentforge-w2`) and its own `AGENTFORGE_CRITIC_MODEL` (no default: unset
means disabled, labeled `critic_status: disabled`) and
`AGENTFORGE_CRITIC_TIMEOUT_MS` (default 4000). It runs only when the scan
deadline leaves at least its timeout; otherwise the answer ships as the
verifier left it, labeled `critic_status: skipped_budget`. Pick the model with
`node agentforge/scripts/benchmark-critic-models.mjs --models a,b,c` inside
the container, where the key is set.

As of S6 (the W2 grounded-answer composer), `agentforge-w2`'s compose block
also sets these same `AGENTFORGE_MODEL_*` variables (previously only the W1
`agentforge` block had them, so `AGENTFORGE_PROVIDER_MODE=qwen` on
`agentforge-w2` had no endpoint/key behind it and silently ran deterministic
only). There is no separate answer-model variable set: `answerComposer.js`'s
`ResilientProvider` reuses the exact same configured client `server.js`
builds from these values, wrapped with the deterministic *composer* as its
fallback instead of the briefing `DeterministicProvider`. Setting these in the
shared `.env` therefore makes both `agentforge` and `agentforge-w2` use the
same model account for their respective jobs (briefing prose vs. the W2
answer's `{claims:[...]}` JSON contract).

For Model Studio, use the region-specific compatible endpoint documented by
Alibaba and confirm the key belongs to that same region. The service retries
the provider twice and rejects output that is empty, overlong, ungrounded in
an exact retrieved field/value pair, or contains clinical action language. It
then falls back to the deterministic provider. The key must never enter the
repository, browser URL, traces, or prompt data. Readiness must still report a
configured-provider outage as not ready; fallback availability does not count
as provider health.

## OpenRouter conversation lane

The provider seam supports an OpenAI-compatible OpenRouter lane for short,
patient-scoped follow-ups. Keep Qwen as the synthesis lane by setting
`AGENTFORGE_PROVIDER_MODE=qwen`; configure the conversation lane separately in
the server-side root `.env`:

```dotenv
AGENTFORGE_PROVIDER_MODE=qwen
AGENTFORGE_OPENROUTER_ENDPOINT=https://openrouter.ai/api/v1/chat/completions
AGENTFORGE_OPENROUTER_API_KEY=<server-only-openrouter-key>
AGENTFORGE_OPENROUTER_MODEL=<approved-openrouter-model>
AGENTFORGE_OPENROUTER_SITE_URL=https://<canonical-host>/agentforge
AGENTFORGE_OPENROUTER_SITE_NAME=AgentForge
AGENTFORGE_OPENROUTER_TIMEOUT_MS=8000
```

To switch lanes, set `AGENTFORGE_PROVIDER_MODE=openrouter`, supply an approved
model, and redeploy the AgentForge service. Do not put the key in the
repository, browser URL, traces, or prompt data. Run the full evaluation,
failure, API-collection, and dashboard readback gates after switching.

## Optional Gemini scan-extraction lane

The isolated W2 service can send synthetic PDF page images to Gemini for
structured field extraction. It is off by default; only the `agentforge-w2`
service receives the key. The adapter grounds each returned value in an OCR
quote and uses local OCR coordinates for its citation box. If the quote cannot
be found in OCR output, that field is withheld. Do not enable this lane for
live OpenEMR mode or real patient data.

```dotenv
AGENTFORGE_SCAN_PROVIDER_MODE=gemini
AGENTFORGE_GEMINI_SCAN_MODEL=gemini-3.8-flash
AGENTFORGE_GEMINI_SCAN_TIMEOUT_MS=45000
AGENTFORGE_GEMINI_SCAN_DAILY_LIMIT=12
GEMINI_API_KEY=<server-only-google-ai-key>
```

The model call is made only for synthetic W2 PDF extraction; the existing
Tesseract-only path remains the default when the mode is `local`. Keep the key
in `/opt/agentforge-week1/.env`; never commit it or expose it to the browser,
traces, or request payloads. Google model output remains untrusted and must
pass local schema, quote, page, and bounding-box validation.

The adapter retries HTTP 429, 500, 502, 503, and 504 responses up to two times
with bounded exponential backoff. It honors `Retry-After` up to five seconds;
longer delays are returned as failures for a later user retry. The daily limit
counts every outbound attempt, including retries. Timeouts and malformed
responses are not retried.

## Guideline hybrid RAG lane (S5, `agentforge-w2` only)

`agentforge-w2` retrieves guideline evidence with real BM25 sparse search
unioned with Gemini dense embeddings, reranked by a separately-configured
`Reranker` (`AGENTFORGE_RAG_PROVIDER=gemini-hybrid`; the reranker seam itself
is `agentforge/src/reranker.js`). This is the `agentforge-w2` compose
default; the frozen Week 1 `agentforge` service is untouched and keeps its
own default (`local-lexical`, real BM25 only — see D8).

```dotenv
AGENTFORGE_RAG_PROVIDER=gemini-hybrid
GEMINI_API_KEY=<server-only-google-ai-key>
```

### Reranker: Qwen by default, pluggable (owner decision 2026-09-24)

The Gemini key above is a **free-tier key** (gemini-3.8-flash: 20
requests/day, 5/min) — enough for dense embeddings, but a listwise rerank
call on every request exhausts it immediately. Dense retrieval therefore
stays on Gemini embeddings; **reranking is a separate, pluggable
collaborator** selected by `AGENTFORGE_RERANK_PROVIDER`:

| `AGENTFORGE_RERANK_PROVIDER` | Reranker | Credentials | Notes |
|---|---|---|---|
| `qwen` (default for W2) | `createQwenReranker` | `AGENTFORGE_MODEL_ENDPOINT` + `AGENTFORGE_MODEL_API_KEY` (same env as the Qwen synthesis lane above — no separate secret) | `AGENTFORGE_RERANK_MODEL` default `qwen3.8-flash`; `AGENTFORGE_RERANK_TIMEOUT_MS` default `6000` |
| `gemini` | `createGeminiReranker` (adapts the existing Gemini listwise reranker) | `GEMINI_API_KEY` (same key as embeddings) | The original all-Gemini pipeline; hits the free-tier limit above under real load |
| `cohere` (not deployed; implemented as a proof the seam is pluggable) | `createCohereReranker` | `AGENTFORGE_COHERE_API_KEY` | Calls Cohere's dedicated `/v2/rerank` endpoint directly, no prompt/JSON-parsing surface |

```dotenv
AGENTFORGE_RERANK_PROVIDER=qwen
AGENTFORGE_RERANK_MODEL=qwen3.8-flash
AGENTFORGE_RERANK_TIMEOUT_MS=6000
```

A `Reranker` is `{name, rerank(query, candidates: [{id, text}], {signal}) =>
{results: [{id, score}], usage}}` (full contract documented in
`reranker.js`). Adding a future dedicated reranker (a different Cohere
model, or another vendor) means writing one small file implementing this
interface — never touching the BM25/embedding/candidate-union code in
`guidelineEvidence.js`.

The response's `provider` field names both collaborators that actually ran,
e.g. `hybrid:gemini-embedding-2+alibaba-qwen:qwen3.8-flash` — never a
static label independent of what the request actually did.

The retriever needs the following to run as full hybrid rather than degrade:

- `agentforge/corpus/guidelines/corpus.json` — the real guideline corpus
  (committed; see `corpus/guidelines/README.md` for sources and licensing).
- `agentforge/corpus/embeddings.json` — precomputed corpus embeddings, built
  offline (not by the deployed server) and committed once available:

  ```bash
  GEMINI_API_KEY=... node agentforge/scripts/build-corpus-embeddings.mjs
  ```
- A configured, reachable reranker for whichever `AGENTFORGE_RERANK_PROVIDER`
  is selected.

Degraded modes (never silently reported as a full hybrid result — AGENTS.md):

- `degraded: "sparse_only"` — no embed client/reranker configured,
  `embeddings.json` missing, or the embed/dense-scoring step itself failed
  (including a dimension mismatch between the query embedding and the
  precomputed corpus vectors, e.g. built with a different model or
  `outputDimensionality` — treated as a failure, not "no similarity").
- `degraded: "no_rerank"` — the embed step succeeded (dense candidates are
  real) but the reranker itself failed or timed out; the response fuses the
  sparse+dense candidates by reciprocal rank instead of discarding the
  already-paid-for dense work, but is never presented as a real rerank
  judgment.
- `degraded: "stub"` — the full pipeline shape ran, but one or more steps
  were answered by a deterministic test/gate stand-in (`recorded-or-stub`,
  no matching recorded fixture) rather than a real or recorded response.

The evidence-retrieval query is formulated server-side from the uploaded
document's own typed abnormal lab results and the intake chief concern
(`agentforge/src/activeWorkers.js`); a client-supplied `message` is only ever
appended as an optional clinician question, never sent verbatim as the
query. Before anything reaches an embed or rerank call, it is further
reduced to only the words this corpus's own vocabulary recognizes
(`sanitizeForExternalModel`, `agentforge/src/guidelineEvidence.js` — applies
to every external model this pipeline calls, not only Gemini) — a name, date
of birth, phone number, or any other free text a clinician or patient typed
is dropped rather than sent to any of them. The local BM25 search (which
never leaves this process) still runs on the original, unsanitized query.

Re-verify the corpus is still an exact, contiguous excerpt of its live
sources (network access required, not part of the pre-commit hook) with:

```bash
node agentforge/scripts/verify-corpus.mjs
```

To record deterministic fixtures for the test suite and the eval gate (so
they need no live keys), after building the corpus embeddings above, run
from inside the `agentforge-w2` container (where the real keys already live
in env) — this records embeddings from Gemini and reranks from whichever
`AGENTFORGE_RERANK_PROVIDER` is currently configured (default `qwen`):

```bash
openemr-cmd worktree exec <branch> e 'GEMINI_API_KEY=$GEMINI_API_KEY AGENTFORGE_MODEL_ENDPOINT=$AGENTFORGE_MODEL_ENDPOINT AGENTFORGE_MODEL_API_KEY=$AGENTFORGE_MODEL_API_KEY node agentforge/scripts/record-retrieval-fixtures.mjs'
# or, against the primary clone's stack (non-worktree mode):
openemr-cmd e 'GEMINI_API_KEY=$GEMINI_API_KEY AGENTFORGE_MODEL_ENDPOINT=$AGENTFORGE_MODEL_ENDPOINT AGENTFORGE_MODEL_API_KEY=$AGENTFORGE_MODEL_API_KEY node agentforge/scripts/record-retrieval-fixtures.mjs'
```

Fixtures are keyed by provider+model (both embed and rerank), and the
completion manifest (`test/fixtures/retrieval/COMPLETE.json`) records which
reranker produced them (`rerank_provider`/`rerank_model`). The gate
(`w2RegressionGate.js`) uses the real corpus vectors and recorded rerank
fixtures only when that manifest matches its own configured
`AGENTFORGE_RERANK_PROVIDER`/`AGENTFORGE_RERANK_MODEL` — switching the
deployed reranker without re-recording fixtures makes the gate fall back to
its deterministic stand-in rather than silently testing the wrong lane.

Until fixtures are recorded, tests and the gate use a deterministic,
honestly-labeled stand-in (`recorded-or-stub` — `agentforge/src/
geminiClient.js` for embeddings/Gemini rerank,
`createRecordedOrStubReranker` in `agentforge/src/reranker.js` for every
other reranker) — never a live client, and never presented as one.

## Active split provider lanes

For the current synthetic deployment, keep the synthesis lane on Qwen and use
the funded conversation lane for short follow-ups.
The conversation model receives the cached, verified evidence package; it does
not retrieve records or decide what claims are displayable. If it fails or
returns ungrounded text, the deterministic evidence-only answer is used.

```dotenv
AGENTFORGE_PROVIDER_MODE=qwen
AGENTFORGE_CONVERSATION_PROVIDER_MODE=openrouter
AGENTFORGE_CONVERSATION_OPENROUTER_API_KEY=<server-only-openrouter-key>
AGENTFORGE_CONVERSATION_OPENROUTER_MODEL=google/gemini-2.5-flash-lite
AGENTFORGE_CONVERSATION_OPENROUTER_TIMEOUT_MS=8000
```

The calendar integration should call the existing preparation service ahead of
the scheduled visit, persist the returned correlation ID, and open the cached
briefing when the clinician enters the encounter. The current deployment keeps
the lane opt-in at configuration level, while the live synthetic candidate has
activated it with the server-side OpenRouter key. Mercury 2.5 was tested but
returned an upstream provider error on the selected route, so Flash-Lite is the
current low-cost interactive model. This is a provider choice, not a PHI or
clinical-approval claim.

The synthetic checkpoint now exposes that seam without a calendar connector:
`POST /agentforge/v1/prewarm` accepts a signed synthetic context plus
`schedule_revision` and returns a correlation ID immediately; the background
preparation reuses `AgentForgeService.prepare()`. The caller can open the
completed result with `POST /agentforge/v1/prewarm/{correlation_id}/open`.
Duplicate schedule bindings are idempotent, and cache entries retain patient,
clinician, schedule, source, and expiry bindings. Real calendar and PHI
integration remain out of scope.

## Optional self-hosted Langfuse lane

The AgentForge container can export redacted operational spans to a separately
hosted Langfuse v4 instance on the same VM. This is disabled unless all three
server-only values are supplied:

```dotenv
LANGFUSE_BASE_URL=http://langfuse-web:3000
LANGFUSE_PUBLIC_KEY=<server-only-project-public-key>
LANGFUSE_SECRET_KEY=<server-only-project-secret-key>
LANGFUSE_TIMEOUT_MS=3000
```

The exporter is fail-safe: the local redacted trace file remains authoritative,
and Langfuse outage does not change readiness or the synthetic response path.
Do not expose the Langfuse API or credentials through Caddy until its Compose
version, network policy, retention, backup, and dashboard readback have been
approved and verified. The repository contains a pinned, unactivated artifact
under [`deploy/vultr/langfuse`](langfuse), not a deployed Langfuse instance.

## Before any PHI

- Point a real DNS name at the server and configure a trusted certificate; the
  current IP-based demonstration uses self-signed TLS.
- Redirect HTTP to HTTPS after the trusted certificate is installed.
- Restrict SSH in the Vultr firewall to an administrator-controlled source.
- Rotate/revoke the historical Composer credential that was previously present
  in upstream development Compose files; removing it from the working tree
  does not erase it from Git history.
- Establish the retention, deletion, audit-review, incident-response, and
  breach-notification procedures, and execute the required BAA before sending
  PHI to any hosted service or LLM provider.

The AgentForge audit remains the source of truth for the unresolved provider
terms, identity, observability, and compliance gates beyond this synthetic lane.

The optional Langfuse artifact is isolated under
[`deploy/vultr/langfuse`](langfuse). The main Compose project creates the shared
`agentforge-observability` network; the Langfuse project joins it as an external
network. The Langfuse UI and object store remain VM-loopback-only and are not
routed by Caddy.
