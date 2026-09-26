Audited by: tier 2 (sonnet)
Date: 2026-09-25
Git SHA: 3ccfe1d

# `deploy/vultr/` walkthrough

Files present: `docker-compose.yml`, `Caddyfile`, `deploy.sh`, `README.md`,
`langfuse/` (separate, isolated compose project — see below). No `.env`
template file is committed; `README.md` documents the required keys inline
(quoted below, names only — no values are real secrets in this repo, they
are all `<placeholder>` text in the README, or `${VAR:?required}`/
`${VAR:-default}` interpolations in the compose file that read from a
server-only `.env` that is explicitly **not** part of the repository —
`deploy/vultr/README.md:8,21`).

## Services (`deploy/vultr/docker-compose.yml`)

### `mysql`
- Image: `mariadb:11.8.8@sha256:be1ef4fe5f14589325c08a41c76334097ce66c86264b75e1d28342c742782a61` (same pin as the dev stack) — `docker-compose.yml:4`.
- Volume: `databasevolume:/var/lib/mysql` (named volume, declared `docker-compose.yml:230`) — no bind mounts.
- Env: `MYSQL_ROOT_PASSWORD` — required, no default (`${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD is required}`) — `docker-compose.yml:9`.
- Healthcheck: same `healthcheck.sh --su-mysql --connect --innodb_initialized` pattern as dev, `timeout: 20s` (vs dev's 5s) — `docker-compose.yml:10-16`.

### `openemr`
- Image: `openemr/openemr:latest@sha256:faf0b8386895ed7ab1891bb7c94012e50a91917113e3ae7111b5287d28546b38` — **note**: this is the `latest` tag pinned by digest, not the `flex` tag the dev stack uses — `docker-compose.yml:20`.
- Volumes — `docker-compose.yml:21-24`:
  - `logvolume01:/var/log` (named volume)
  - `sitevolume:/var/www/localhost/htdocs/openemr/sites` (named volume)
  - `../../interface/modules/custom_modules/oe-module-agentforge:/var/www/localhost/htdocs/openemr/interface/modules/custom_modules/oe-module-agentforge` (**bind mount** — this is how the deployed module code path reaches the running OpenEMR container; `deploy.sh` later `chown`/`chmod`s this path to the apache uid after extraction, see below).
- Env vars (names only) — `docker-compose.yml:26-42`: `MYSQL_HOST` (fixed `mysql`), `MYSQL_ROOT_PASS`, `MYSQL_USER`, `MYSQL_PASS`, `OE_USER`, `OE_PASS`, `AGENTFORGE_DEMO_SECRET` (optional, default empty), `AGENTFORGE_SERVICE_URL` (required), `AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS` (required), `AGENTFORGE_DEMO_ACTOR_USERNAME` (required), `AGENTFORGE_MODULE_HMAC_SECRET` (required). Comments explain the last three are the W2 OpenEMR-round-trip allowlist (`docker-compose.yml:34-42`).
- `depends_on: mysql: condition: service_healthy`; healthcheck identical shape to dev (`/meta/health/readyz`, start_period 3m) — `docker-compose.yml:43-60`.

### `agentforge` (Week 1 — frozen)
- Image: `agentforge-w1:84f232b` — a **local VM tag**, no registry, no `build:` section — `docker-compose.yml:67`. Comment: "Week 1 is frozen (PLAN D8)... taken from the running W1 container (built from 84f232b, image sha256:fa4a6543a80a...). No build: section, so no compose rebuild can replace W1 with W2 code" — `docker-compose.yml:64-66`, corroborated by `README.md:13-17`.
- Port exposure: none declared in compose (reached only via the `proxy` service internally).
- Env vars (names only, ~40) — `docker-compose.yml:69-120`: `PORT` (fixed 8787), `AGENTFORGE_FIXTURES` (fixed path), `AGENTFORGE_DEMO_SECRET`, `AGENTFORGE_SYNTHETIC_CONTEXT` (default `true`), `AGENTFORGE_OPENEMR_MODE` (default `synthetic`), `AGENTFORGE_TRACE_PATH`, `AGENTFORGE_PUBLIC_BASE_PATH` (default `/agentforge`), `AGENTFORGE_OPENEMR_BASE_URL`, `AGENTFORGE_OPENEMR_ACCESS_TOKEN`, `AGENTFORGE_OPENEMR_TOKEN_URL`, `AGENTFORGE_OPENEMR_CLIENT_ID`, `AGENTFORGE_OPENEMR_CLIENT_SECRET`, `AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH`, `AGENTFORGE_OPENEMR_TIMEOUT_MS`, `AGENTFORGE_MODEL_ENDPOINT`, `AGENTFORGE_MODEL_PROTOCOL` (default `responses`), `AGENTFORGE_MODEL`, `AGENTFORGE_MODEL_API_KEY`, `AGENTFORGE_MODEL_SITE_URL`, `AGENTFORGE_MODEL_SITE_NAME`, `AGENTFORGE_MODEL_TIMEOUT_MS`, `AGENTFORGE_PROVIDER_MODE` (default `qwen`), `AGENTFORGE_OPENROUTER_ENDPOINT`, `AGENTFORGE_OPENROUTER_API_KEY`, `AGENTFORGE_OPENROUTER_MODEL`, `AGENTFORGE_OPENROUTER_SITE_URL`, `AGENTFORGE_OPENROUTER_SITE_NAME`, `AGENTFORGE_OPENROUTER_TIMEOUT_MS`, `AGENTFORGE_CONVERSATION_PROVIDER_MODE`, `AGENTFORGE_CONVERSATION_MODEL_ENDPOINT`, `AGENTFORGE_CONVERSATION_MODEL_PROTOCOL` (default `compatible`), `AGENTFORGE_CONVERSATION_MODEL`, `AGENTFORGE_CONVERSATION_MODEL_API_KEY`, `AGENTFORGE_CONVERSATION_MODEL_TIMEOUT_MS`, `AGENTFORGE_CONVERSATION_OPENROUTER_*` (endpoint/key/model/site url/site name/timeout), `AGENTFORGE_JEV_MODE` (default `off`), `JEV_ENDPOINT`, `JEV_MODEL`, `JEV_API_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_TIMEOUT_MS`, `LANGFUSE_MAX_PENDING_EXPORTS`.
- Volumes: `tracevolume:/data` (named), `../../secrets/openemr-token.json:/run/secrets/agentforge-openemr-token.json` (**bind mount** of a repo-relative but git-ignored path — `README.md:39` says "Keep `secrets/openemr-token.json` root-only and server-side") — `docker-compose.yml:121-123`.
- Networks: `default` + `agentforge-observability` (external-facing Langfuse bridge network, declared `docker-compose.yml:236-237`) — `docker-compose.yml:124-126`.
- Healthcheck: Node one-liner hitting `http://localhost:8787/ready` — `docker-compose.yml:127-131`.
- `depends_on: openemr: condition: service_healthy` — `docker-compose.yml:132-134`.

### `agentforge-w2` (Week 2 — active build)
- **Does** have a `build:` section: `context: ../..` (repo root), `dockerfile: Dockerfile` (repo-root `Dockerfile`, see below) — `docker-compose.yml:143-145`. This is the only service in this compose file built from local source rather than pulled/tagged.
- Env vars (names only, ~45; comment-documented flags called out below) — `docker-compose.yml:147-195`: `PORT` (fixed 8788), `AGENTFORGE_FIXTURES` (fixed path), `AGENTFORGE_DEMO_SECRET` (**required**, no default — differs from W1's optional-empty version), `AGENTFORGE_SYNTHETIC_CONTEXT` (fixed `"true"`, not overridable via env here), `AGENTFORGE_OPENEMR_MODE` (fixed `synthetic`, not overridable), `AGENTFORGE_PUBLIC_BASE_PATH` (fixed `/agentforge-w2`), `AGENTFORGE_PROVIDER_MODE` (fixed `qwen`), `AGENTFORGE_MODEL_ENDPOINT`, `AGENTFORGE_MODEL_PROTOCOL`, `AGENTFORGE_MODEL` (reads `AGENTFORGE_W2_MODEL` first, falls back to `AGENTFORGE_MODEL`, then `configured-model`), `AGENTFORGE_MODEL_API_KEY`, `AGENTFORGE_MODEL_SITE_URL`, `AGENTFORGE_MODEL_SITE_NAME`, `AGENTFORGE_MODEL_TIMEOUT_MS` (reads `AGENTFORGE_W2_MODEL_TIMEOUT_MS`, default 18000), `AGENTFORGE_MODEL_ENABLE_THINKING` (reads `AGENTFORGE_W2_MODEL_ENABLE_THINKING`, default `false`), `AGENTFORGE_SCAN_DEADLINE_MS` (default 25000), `AGENTFORGE_RAG_PROVIDER` (fixed `gemini-hybrid`), `AGENTFORGE_RERANK_PROVIDER` (default `qwen`), `AGENTFORGE_RERANK_MODEL` (default `qwen3.8-flash`), `AGENTFORGE_RERANK_TIMEOUT_MS` (default 6000), `AGENTFORGE_SCAN_PROVIDER_MODE` (default `local`), `AGENTFORGE_GEMINI_SCAN_MODEL` (default `gemini-3.8-flash`), `AGENTFORGE_GEMINI_SCAN_TIMEOUT_MS` (default 45000), `AGENTFORGE_GEMINI_SCAN_DAILY_LIMIT` (default 12), `GEMINI_API_KEY`, `AGENTFORGE_TRACE_PATH` (fixed `/tmp/agentforge-w2-traces.json`, not persisted to a volume — ephemeral), `AGENTFORGE_PERSISTENCE_MODE` (fixed `openemr-module`), `AGENTFORGE_OPENEMR_MODULE_URL` (fixed internal module API URL), `AGENTFORGE_OPENEMR_MODULE_TIMEOUT_MS` (default 15000), `AGENTFORGE_MODULE_HMAC_SECRET` (**required**), `AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS` (**required**), `AGENTFORGE_OPENEMR_DEMO_PATIENT_MAP` (**required**) — `docker-compose.yml:147-195`.
- No volumes declared for `agentforge-w2` (its trace path is in-container `/tmp`, not persisted).
- `expose: ["8788"]` (internal only, reached via `proxy`) — `docker-compose.yml:196-197`.
- Healthcheck: Node one-liner against `/ready` on 8788 — `docker-compose.yml:198-202`.
- Resource limits: `cpus: "0.50"`, `memory: 512M` (`deploy.resources.limits`) — `docker-compose.yml:203-207`.

### `proxy`
- Image: `caddy:2.9.1-alpine` — `docker-compose.yml:211`.
- Ports: `80:80`, `443:443` (the only host-published ports in this compose file) — `docker-compose.yml:212-214`.
- Volumes: `./Caddyfile:/etc/caddy/Caddyfile:ro` (bind mount), `caddy_data:/data` (named), `caddy_config:/config` (named) — `docker-compose.yml:215-218`.
- `depends_on`: `openemr`, `agentforge`, `agentforge-w2`, all `condition: service_healthy` — `docker-compose.yml:219-225`.

Top-level named volumes (`docker-compose.yml:227-233`): `logvolume01`,
`sitevolume`, `databasevolume`, `caddy_data`, `caddy_config`, `tracevolume`.
Top-level network (`docker-compose.yml:235-237`): `agentforge-observability`
(external-joinable bridge network shared with the separate `langfuse/`
compose project).

## Which code paths are enabled/disabled, and by what flag

- **Live vs. synthetic OpenEMR mode** (W1 `agentforge` service only):
  `AGENTFORGE_OPENEMR_MODE` — default `synthetic`; README says set explicitly
  to `live` for the real-record read path, which additionally requires a
  provisioned OAuth client (`AGENTFORGE_OPENEMR_CLIENT_ID/SECRET`,
  `AGENTFORGE_OPENEMR_TOKEN_URL`) — `README.md:52-56`. "The fixture/demo
  context issuer is disabled in live mode" — `README.md:53`.
- **W2 persistence into OpenEMR**: `AGENTFORGE_PERSISTENCE_MODE=openemr-module`
  is hardcoded on `agentforge-w2` (not a toggle in this compose file) —
  `docker-compose.yml:189`. It calls
  `http://openemr/interface/modules/custom_modules/oe-module-agentforge/public/api.php`
  over the Docker network only; the `Caddyfile`'s
  `agentforge_module_internal_only` snippet (`Caddyfile:1-16`) 404s every
  public path under `oe-module-agentforge/` except the W1 launcher
  `public/index.php`, so the module's write endpoint is unreachable from
  outside the Docker network regardless of HMAC signing.
- **Writes gated by allowlist**: `AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS` (on
  both `openemr` and `agentforge-w2`) restricts which OpenEMR patient UUIDs
  the public synthetic demo may write to; `AGENTFORGE_OPENEMR_DEMO_PATIENT_MAP`
  maps fixture patients to those allowlisted UUIDs — `README.md:82-87`. Until
  the module's tables are installed, the endpoint answers `503
  ledger_not_installed` — `README.md:94-95`.
- **Guideline retrieval hybrid vs. degraded**: `AGENTFORGE_RAG_PROVIDER=gemini-hybrid`
  (fixed for `agentforge-w2`) needs a reachable Gemini embed client plus a
  configured `AGENTFORGE_RERANK_PROVIDER` (`qwen` default; `gemini` and
  `cohere` also implemented) and a committed `agentforge/corpus/embeddings.json`
  to run as "full hybrid." Documented degrade states, each explicitly
  labeled rather than silently reported as full hybrid (`README.md:259-273`):
  `degraded: "sparse_only"`, `degraded: "no_rerank"`, `degraded: "stub"`.
- **Scan extraction lane**: `AGENTFORGE_SCAN_PROVIDER_MODE` — default `local`
  (Tesseract-only); set to `gemini` (with `GEMINI_API_KEY`) to enable
  Gemini-assisted structured field extraction, off by default and documented
  as "Do not enable this lane for live OpenEMR mode or real patient data" —
  `README.md:172-193`.
- **Conversation follow-up lane**: `AGENTFORGE_CONVERSATION_PROVIDER_MODE`
  (empty/unset by default in compose; README's "Active split provider lanes"
  section documents setting it to `openrouter` with a separate model/key) —
  `docker-compose.yml:97`, `README.md:321-335`.
- **Optional Langfuse export**: only activates when all three of
  `LANGFUSE_BASE_URL`/`LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` are set;
  "fail-safe: the local redacted trace file remains authoritative, and
  Langfuse outage does not change readiness" — `README.md:355-369`. The
  actual Langfuse service stack lives in the separate `deploy/vultr/langfuse/`
  compose project, described by its own README as "a pinned, unactivated
  artifact... not a deployed Langfuse instance" — `README.md:372-373`.
- **W1 is architecturally frozen**: no `build:` section on the `agentforge`
  service is itself the enforcement mechanism — there is no flag that could
  re-point it at W2 source short of hand-editing the `image:` line —
  `README.md:13-17`, `docker-compose.yml:62-67`.

## Repo-root `Dockerfile` (built by `agentforge-w2`)

`Dockerfile:1-16`. `FROM node:24-alpine`; installs `poppler-utils
tesseract-ocr tesseract-ocr-data-eng`; copies in `agentforge/package.json`,
`agentforge/package-lock.json`, and **`agentforge/BUILD_SHA`** (see SHA
reporting below) before `npm ci --omit=dev --prefix agentforge`; then copies
`agentforge/src`, `agentforge/scripts`, `agentforge/test`, `agentforge/corpus`,
`observability`, two `evals/*.json` result files, and
`docs/agentforge/{fixtures,evidence,schemas}`; sets `PORT=8787` and
`AGENTFORGE_FIXTURES` as image-level defaults (both overridden by the compose
file's own env block for the `agentforge-w2` service); `EXPOSE 8787`;
`CMD ["node", "src/server.js"]`.

## How the deployed SHA is reported

- `agentforge/BUILD_SHA` is a placeholder file (`$Format:%H$`) marked
  `export-subst` in `.gitattributes:55`. Comment in `agentforge/src/buildInfo.js:9`:
  "`agentforge/BUILD_SHA` is marked `export-subst`, so `git archive` (the
  deploy path) replaces its placeholder with the commit hash."
- `readBuildSha()` (`agentforge/src/buildInfo.js:21-27`) reads that file; if
  it matches a 40-hex-char SHA pattern, uses it; otherwise falls back to env
  var `AGENTFORGE_GIT_SHA`; otherwise reports the literal string
  `unversioned` — "never to a guessed value" (`buildInfo.js:11-12`).
- `agentforge/src/server.js:292`: `GET /health` returns
  `{ status: 'ok', git_sha: gitSha }`.
- `deploy/vultr/deploy.sh` is the only path that stamps `BUILD_SHA`: it
  ships the working tree via `git -c core.autocrlf=false archive --format=tar
  "$sha" $paths` (`deploy.sh:59`, `sha=$(git rev-parse HEAD)` at
  `deploy.sh:38`) — `git archive` performs the `export-subst` substitution at
  archive time, so the image built from that extracted tree gets a real SHA
  in `agentforge/BUILD_SHA`.
- `deploy.sh` then polls the public health endpoint after redeploying each
  service and only reports success once it sees the expected SHA:
  `until curl -fsS -m 10 "$public_url/$route/health" ... | grep -q
  "\"git_sha\":\"$sha\""` (`deploy.sh:105`, 30 retries at 5s intervals,
  `deploy.sh:106-111`), for each service actually shipped
  (`AGENTFORGE_DEPLOY_SERVICES`, default `agentforge-w2` — the frozen W1
  `agentforge` service ships only when named explicitly, `deploy.sh:10-11,23`).
- Deploy safety gates before any of this: refuses to run with uncommitted
  changes (`deploy.sh:34-37`) and refuses to deploy a SHA that isn't an
  ancestor of `staging/main` unless `AGENTFORGE_DEPLOY_ALLOW_UNMERGED=1` is
  set (`deploy.sh:38-46`) — this is the mechanism behind `AGENTS.md`'s "one
  deployed SHA" rule.
- `deploy.sh:96` references the running container as `vultr-openemr-1` when
  checking that apache can read the module directory — consistent with a
  Compose project name of `vultr` for this stack (not itself declared as
  `COMPOSE_PROJECT_NAME` in any committed file; inferred from this one
  reference — **guess**, not independently verified since this audit made no
  Docker calls).

## `Caddyfile` routing (`deploy/vultr/Caddyfile:1-57`)

Three near-identical site blocks (a `nip.io` hostname block, plus bare `:80`
and `:443` — the `:443` block uses Caddy's `tls internal`, i.e.
**self-signed** TLS, matching the README's "Before any PHI" call-out that
"the current IP-based demonstration uses self-signed TLS," `README.md:377-378`).
Each block imports `agentforge_module_internal_only` (the module-directory
404 rule described above), then routes `/agentforge-w2*` →
`agentforge-w2:8788`, `/agentforge*` → `agentforge:8787`, and everything else
→ `openemr:80`.

## `deploy/vultr/langfuse/` (separate, currently-unactivated compose project)

Pinned to Langfuse v4.38.0 (worker + web images, both digest-pinned) plus its
own dependency stack (postgres, minio, redis, clickhouse — read from the
directory listing, not fully enumerated here as it is explicitly documented
as unactivated: `deploy/vultr/README.md:372-373`, `"a pinned, unactivated
artifact under deploy/vultr/langfuse, not a deployed Langfuse instance"`).
Env vars (names only, from the `langfuse-worker`/`langfuse-web` env blocks):
`NEXTAUTH_URL`, `DATABASE_URL`, `SALT`, `ENCRYPTION_KEY`, `TELEMETRY_ENABLED`,
`CLICKHOUSE_MIGRATION_URL`, `CLICKHOUSE_URL`, `CLICKHOUSE_USER`,
`CLICKHOUSE_PASSWORD`, `CLICKHOUSE_CLUSTER_ENABLED`,
`LANGFUSE_S3_EVENT_UPLOAD_BUCKET`, `LANGFUSE_S3_EVENT_UPLOAD_REGION`,
`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`,
`LANGFUSE_S3_EVENT_UPLOAD_INTERNAL_ENDPOINT`,
`LANGFUSE_S3_EVENT_UPLOAD_FORCE_PATH_STYLE`, `LANGFUSE_S3_EVENT_UPLOAD_PREFIX`,
`LANGFUSE_S3_MEDIA_UPLOAD_*` (parallel set), `REDIS_HOST`, `REDIS_PORT`,
`REDIS_AUTH`, `REDIS_TLS_ENABLED`, `EMAIL_FROM_ADDRESS`,
`SMTP_CONNECTION_URL`. All values are `${VAR:?required}`/`${VAR:-default}`
interpolations from an external `.env`, no literal secrets committed. The
project joins the shared `agentforge-observability` external network; per
the main README the Langfuse UI/object store stay VM-loopback-only and are
not routed by the main Caddy instance — `README.md:391-395`.

## Notes / redactions

No literal secret values were found in any file audited here. Every
credential-shaped value in `deploy/vultr/docker-compose.yml` is either a
`${VAR:?required}`/`${VAR:-default}` reference to a server-only, git-ignored
`.env` (`README.md:8-11,21` — root at `/opt/agentforge-week1/.env`, mode 600,
not part of the repository), or an explicit non-secret literal (e.g. fixed
port numbers, fixed internal URLs, model names). `README.md:381-383` itself
flags a historical concern worth surfacing to the repo owner rather than
silently noting: "Rotate/revoke the historical Composer credential that was
previously present in upstream development Compose files; removing it from
the working tree does not erase it from Git history" — this is the
project's own documentation naming a **past** committed secret in git
history (not this repo's `deploy/vultr/` files, and not something this
audit located directly — flagging per the task's escalation rule since it is
a credential-in-history claim, even though it is self-reported and already
called out in the README rather than newly discovered here).
