# Vultr deployment

This Compose file is suitable for the public synthetic AgentForge checkpoint
demonstration only. It is not approved for real patient data.

The public URL, `https://dtstest.64.177.10.182.nip.io`, is public and appears
throughout the repository; as a `nip.io` name it contains the VM's IP address.
What is kept out of the repository is SSH access to the owner-controlled VM:
the SSH user, the key, and the `.env` secrets (`deploy.sh` reads the first two
from environment variables). The remote
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
   `AGENTFORGE_DEPLOY_ALLOW_UNMERGED=1`. It builds the `git archive` locally
   first, so a failing archive changes nothing on the VM.
2. **Preflight on the VM:** `secrets/openemr-token.json` must be a file. Both
   AgentForge services bind-mount it. If it is missing, Docker creates a
   root-owned directory in its place for the W1 short-syntax mount, and the
   `agentforge-w2` mount (long syntax, `create_host_path: false`) refuses to
   start. Missing or a directory stops the deploy before anything changes.
   When live chart reads are off, a root-only placeholder is enough:
   `sudo install -m 600 /dev/null /opt/agentforge-week1/secrets/openemr-token.json`.
3. **Backs up** the current sources on the VM to
   `~/agentforge-week1-backups/<stamp>/`.
4. **Ships** the committed tree. If the ship fails, the backed-up sources are
   put back, so a failed ship never leaves an empty build tree.
5. **Fixes** the module's permissions, recreates the proxy if the Caddyfile
   changed, and fails if apache cannot read the module. The check finds the
   `openemr` container through `docker compose exec`, not by container name.
6. **Builds and replaces** the named services. Before the replace, the
   runner tags each running image as `<service>:previous` and records the
   pairs in `/tmp/agentforge-deploy-<stamp>/previous`. This step is hardened against
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
   deployed SHA on the public URL. The frozen W1 `agentforge` service is the
   exception: it must report the SHA pinned in its `image: agentforge-w1:<sha>`
   tag (`84f232b`), never the deployed commit.
8. **Rollback (opt-in).** With `AGENTFORGE_DEPLOY_ROLLBACK=1`, a failed replace
   or a failed SHA health check retags each `<service>:previous` image and
   recreates the service with `up -d --no-deps --no-build --force-recreate`.
   The deploy still exits 1. Without it, the new containers stay live and the
   failure message prints the manual rollback command. Rollback restores
   images only: sources, `.env`, the database and volumes are not rolled back.

To follow a build by hand:
`ssh <host> tail -f /tmp/agentforge-deploy-<stamp>/build.log`.

Offline tests cover these behaviors with fake `ssh`, `docker` and `curl`:
`sh deploy/vultr/test/deploy.test.sh`. They are run by `.githooks/pre-commit`
and mirrored by the `deploy-script` job in `.gitlab-ci.yml`. They cannot show
that `setsid`/`nohup` survive a real SSH reset on the VM. The next real deploy
is the first observation of that.

## Proxy (Caddy)

`Caddyfile` serves the public host with a publicly trusted certificate, plus a
`:443` catch-all with an internal certificate for access by IP. Plain HTTP on
`:80`, by IP or any name, is redirected (308) to
`https://dtstest.64.177.10.182.nip.io`; nothing is served unencrypted. Services
reach each other by Docker DNS name (`http://openemr`, `agentforge-w2:8788`),
never through Caddy, so the redirect does not affect them. Response headers:
`Strict-Transport-Security: max-age=31536000` on the public host only, and
`X-Frame-Options: SAMEORIGIN` and `Referrer-Policy:
strict-origin-when-cross-origin` on both HTTPS blocks, each only when the
upstream did not set it. The AgentForge routes also get
`X-Content-Type-Options: nosniff`; it is not set site-wide because legacy
OpenEMR pages were not tested with it. Check after a deploy:
`curl -s -D - -o /dev/null https://dtstest.64.177.10.182.nip.io/agentforge-w2/health` and
`curl -sI http://64.177.10.182/` (expect 308).

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
the authenticated session's `pid` and creates an Ed25519-signed context (280 s;
see "Launcher signing key" below). The
AgentForge service then uses the allowlisted OpenEMR REST read routes with a
server-only OAuth access token. The token must be provisioned through the
approved OpenEMR OAuth client path; missing or invalid authorization keeps live
mode not ready. The fixture/demo context issuer is disabled in live mode.
Set `AGENTFORGE_OPENEMR_MODE=live` explicitly for that path. The default Compose
mode is `synthetic`; it requires `AGENTFORGE_SYNTHETIC_CONTEXT=true` and a
non-empty `AGENTFORGE_DEMO_SECRET` before `/ready` can report ready.

## Evaluator access key and mint rate limit (W3 security fix, `agentforge-w2`)

The W3 red-team found that the synthetic-context mints on `/agentforge-w2`
issued tokens to anyone. `/v1/demo-context` issued read tokens (F-831d4df407).
`/v1/source-document-context` issued write tokens, and
`/v1/clinical-action-context` is the same class of bug (F-24b44c5180). None of
them were rate limited (F-6ee92046fb). All three mints share a per-client rate
limit, and they can require an evaluator key:

```dotenv
# `key` requires AGENTFORGE_DEMO_ACCESS_KEY on every mint (the code default).
# `open` skips the key; the rate limit and the aud check stay on. Compose
# defaults agentforge-w2 to `open`: the final W2 submission carries no key.
AGENTFORGE_DEMO_ACCESS=open
AGENTFORGE_DEMO_ACCESS_KEY=<random value, e.g. openssl rand -hex 16; required when AGENTFORGE_DEMO_ACCESS=key>
# Optional; defaults shown. Mints per client address per window, over all three routes.
AGENTFORGE_MINT_RATE_LIMIT=15
AGENTFORGE_MINT_RATE_WINDOW_SECONDS=60
```

- **Mode (current deployment: `open`).** The owner decided on 2026-09-29 that
  graders must reach the public demo without a key: the W2 submission is
  final and names none. `key` mode was deployed and verified live on
  `40cfbdff` (`docs/agentforge/evidence/W3-redteam-fixes-live.md`). To turn it
  back on, set `AGENTFORGE_DEMO_ACCESS=key` in `.env` and redeploy. In
  `open` mode, F-831d4df407 and F-24b44c5180 are accepted risks. The
  compensating controls are the rate limit, 300 s tokens, the `aud` check,
  synthetic-only data, and writes limited to allowlisted synthetic patients.
- **Key (`key` mode).** A client sends the key in the `X-AgentForge-Demo-Key` header. The
  server compares it in constant time; missing or wrong returns 401
  `demo_access_key_required`. If the key is unset, every mint returns 503
  `demo_access_key_not_configured` and `/ready` is 503. The public page asks
  for the key once ("Evaluator access code") and keeps it in
  `sessionStorage` for the tab. Pages launched from OpenEMR never mint, so
  they need no key.
- **Rate limit.** Over the limit returns 429 `mint_rate_limited` with
  `Retry-After` in seconds. The limit is checked before the key, so key
  guessing is throttled too. 15 per minute covers the UI: about 2 mints per
  patient opened, plus 2 per upload. A load test through the mints needs a
  higher `AGENTFORGE_MINT_RATE_LIMIT` for its run.
- **Client address.** Compose sets `AGENTFORGE_TRUST_PROXY=true` for
  `agentforge-w2` only. That service publishes no port. Caddy 2.9 ignores
  client-sent `X-Forwarded-*` headers (no `trusted_proxies` is configured),
  so the rightmost `X-Forwarded-For` entry is always the real peer. Do not set
  it on a service that clients can reach directly.
- **Audience.** W2 mints add `aud: agentforge-w2`, and W2 rejects
  `synthetic-demo` tokens without it. The frozen Week 1 service signs with the
  same `AGENTFORGE_DEMO_SECRET` and still mints anonymously. Before this check,
  its tokens were accepted on `/agentforge-w2`.

Operational scripts (`load-test.mjs`, `w2-live-acceptance.mjs`,
`w2-openemr-smoke.mjs`, `measure-live-metrics.mjs`, `evals/lib/runner.js`)
read the key from `AGENTFORGE_DEMO_ACCESS_KEY` in their own environment.

## Week 2 OpenEMR round-trip (oe-module-agentforge)

The `agentforge-w2` service keeps the synthetic fixture chart but persists
uploads in OpenEMR (`AGENTFORGE_PERSISTENCE_MODE=openemr-module`, set in
Compose). It calls the module's internal endpoint
`http://openemr/interface/modules/custom_modules/oe-module-agentforge/public/api.php`
over the Docker network; Caddy answers 404 publicly for everything under the
module directory except the Week 1 launcher `public/index.php`. Every call is
HMAC-signed with a key derived from `AGENTFORGE_MODULE_HMAC_SECRET` (held only
by `openemr` and `agentforge-w2`, never by the Week 1 `agentforge` service) and
carries a context token: a `synthetic-demo` token signed with
`AGENTFORGE_DEMO_SECRET`, or the launcher's Ed25519-signed `openemr-module`
token forwarded unchanged (verified with `AGENTFORGE_LAUNCH_VERIFY_KEY`; an
`openemr-module` token signed with the demo secret is refused). The module
takes the acting OpenEMR user from that token and accepts only allowlisted
patients, whatever the token's issuer. Writes need a write-scoped token. Lab
rows are stored as preliminary (`prelim`) pending clinician review. A
medication or allergy written for a `synthetic-demo` token is labeled an
unauthenticated synthetic-demo action and stays `unconfirmed`; only a
launcher (`openemr-module`) token records `clinician-confirmed`. Every
successful module read and write is in the OpenEMR audit log (events
`agentforge-read` and `agentforge-write`, ids and counts only). The same
write key with a different body is refused with 409 `idempotency_conflict`. The Week 1
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

## Week 2 trace store, alerts and readiness (F-OBS)

- **Traces survive a deploy.** `agentforge-w2` writes its redacted trace store
  to `/data/w2-traces.json` on the named volume `w2tracevolume` (Compose
  names it `vultr_w2tracevolume` when run from `deploy/vultr/`). It is
  separate from the frozen W1 `tracevolume`. The store keeps the newest
  `AGENTFORGE_W2_TRACE_LIMIT` traces (default 500) for at most
  `AGENTFORGE_W2_TRACE_RETENTION_MS` (default 604800000, 7 days); the file is
  rewritten on each trace, so it stays a few MB. Compose creates the volume on
  the first `up` after this change. Traces held in the old `/tmp` path are not
  migrated. `docker volume rm vultr_w2tracevolume` deletes all W2 traces.
- **Background alerts.** The server evaluates the alert rules every
  `AGENTFORGE_ALERT_EVAL_INTERVAL_MS` (default 60000) and logs each rule's
  ok/firing change once, as a JSON line with codes only:
  `docker compose --env-file /opt/agentforge-week1/.env logs agentforge-w2 | grep agentforge_alert_transition`.
- **Readiness.** `/agentforge-w2/ready` now also calls the OpenEMR module's
  signed `health` route and writes a probe file to the trace volume. A failing
  dependency gives 503 with its name in `failing` and a `reason` code (for
  example `openemrModule` with `OPENEMR_MODULE_TIMEOUT`). Probes are cached for
  30 s and concurrent calls share one probe, so `/ready` traffic costs at most
  one signed module call per 30 s. Because `/ready` depends on OpenEMR, the
  service has `depends_on: openemr (healthy)` and a 60 s healthcheck start
  period. The `proxy` waits only for `agentforge-w2` and the frozen W1
  `agentforge` to start, not to be healthy, so a module outage or a failing W1
  model probe never keeps Caddy (and OpenEMR) down. Langfuse is probed only
  if its variables are set; the `agentforge-w2` block does not pass them today.
- **Corrupt trace file.** If `/data/w2-traces.json` does not parse at startup
  (for example truncated), the service still starts: the file is renamed to
  `w2-traces.corrupt-<ms>.json` on the volume, one
  `agentforge_trace_store_recovered` line is logged (no content), and
  `/ready` reports `traceStore` `TRACE_STORE_CORRUPT` until the next trace is
  written. Delete the `.corrupt-*` file once inspected.
- **Correlation ids.** Each response carries `x-correlation-id`: the caller's
  value only when it is a UUID or 16-64 lowercase hex characters, else a
  server-minted `af-<uuid>` (a rejected value is not stored or forwarded).
  The scan, briefing and follow-up traces in `/v1/traces` have the same
  `correlationId`, and module, OpenEMR REST and model calls send it as
  `x-correlation-id`.

No operator step is required: all four settings have defaults, and the
optional overrides go in `/opt/agentforge-week1/.env`. After the deploy,
check `/agentforge-w2/ready` (`traceStore` and `openemrModule` ready),
`/agentforge-w2/v1/metrics` (`traceLimit: 500`), and that the trace count in
`/agentforge-w2/v1/traces` is not reset by the next deploy.

## W3 hardening: non-root image (lane H2) — one-time operator step

The `agentforge-w2` image (root `Dockerfile`) now runs as the unprivileged
`node` user (uid 1000) and no longer contains `agentforge/test`. The image
creates `/data` owned by `node`, so a new `w2tracevolume` works as is. The
existing volume on the VM holds `w2-traces.json` written by root (mode 600):
the non-root process cannot read it and exits at startup with `EACCES`
(observed in a local container smoke, 2026-10-01). Before the first `up` of
this image, once:

```bash
docker compose --env-file /opt/agentforge-week1/.env stop agentforge-w2
docker run --rm -v vultr_w2tracevolume:/data alpine:3 chown -R 1000:1000 /data
```

Then deploy as usual and check `/agentforge-w2/ready` (`traceStore` ready).
If `AGENTFORGE_OPENEMR_LIVE_READS=on`, the bind-mounted token cache
(`secrets/openemr-token.json`, mounted at
`/run/secrets/agentforge-openemr-token.json`) must also be readable and
writable by uid 1000 (`chown 1000:1000 secrets/openemr-token.json`); the
token provider rewrites it on refresh. PDF OCR and page renders write only to
`/tmp`.

`/agentforge-w2/ready` now also fails when `AGENTFORGE_PROVIDER_MODE=qwen` has
no `AGENTFORGE_MODEL_ENDPOINT` and key (`model` `reason: not_configured`), so
those must stay set in `/opt/agentforge-week1/.env`. Refused requests no
longer create traces; they are counted in `/agentforge-w2/v1/metrics`
`refusals`.

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
| `AGENTFORGE_OPENEMR_LIVE_READS` (`off`) | `on` reads OpenEMR for launcher tokens; any value other than `on`/`off` stops startup, and so does `on` without `AGENTFORGE_LAUNCH_VERIFY_KEY` |
| `AGENTFORGE_LAUNCH_VERIFY_KEY` (empty) | The launcher's Ed25519 public key (below). Empty: every launcher link gets a 503 "OpenEMR launch is not configured" page; the public demo is unchanged. Malformed: startup fails |
| `AGENTFORGE_OPENEMR_BASE_URL` (`http://openemr`) | REST base, over the Docker network |
| `AGENTFORGE_OPENEMR_TOKEN_URL`, `AGENTFORGE_OPENEMR_CLIENT_ID`, `AGENTFORGE_OPENEMR_CLIENT_SECRET` (empty) | The server-only read client that owns the refresh token (the same values Week 1's live mode uses) |
| `AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH` (fixed) | `/run/secrets/agentforge-openemr-token.json`, mounted from `secrets/openemr-token.json` |
| `AGENTFORGE_OPENEMR_TIMEOUT_MS` (`5000`) | REST call timeout |
| `AGENTFORGE_LIVE_EXTERNAL_PROVIDER_APPROVED` (`false`) | `true` lets a live read of a designated patient use the external services (Qwen answer and rerank, the OpenRouter critic, Gemini embeddings and OCR). Otherwise a live read makes no outbound call: deterministic answer, critic `skipped_not_approved`, local BM25 retrieval, and a live briefing is blocked |
| `AGENTFORGE_LIVE_PATIENT_UUIDS` (empty) | The designated synthetic patients, on **both** `openemr` and `agentforge-w2`. The launcher mints live tokens only for these (anyone else gets a 403), and the approval above applies only to them. Empty means nobody |

On the `openemr` service, `AGENTFORGE_SERVICE_URL` is where the launcher link
points. For W2 it must be the public W2 path: `https://<canonical-host>/agentforge-w2`.

### Launcher signing key (W3 H1)

Launcher tokens (`issuer: openemr-module`) are signed with an Ed25519 key
whose private half only the `openemr` container holds. `agentforge-w2` and
the module API verify them with the public half. The frozen Week 1 service
and `agentforge-w2` hold `AGENTFORGE_DEMO_SECRET`, so neither can mint a
launcher token: every verifier refuses an `openemr-module` token that is
HMAC-signed. Compose passes `AGENTFORGE_LAUNCH_SIGNING_KEY` and
`AGENTFORGE_LAUNCH_VERIFY_KEY` to `openemr`, only
`AGENTFORGE_LAUNCH_VERIFY_KEY` to `agentforge-w2`, and neither to the Week 1
`agentforge` service. Generate the pair once, on the VM, straight into the
`.env` (nothing is printed):

```sh
docker run --rm node:24-alpine node -e "const k=require('crypto').generateKeyPairSync('ed25519').privateKey.export({format:'jwk'});const b=(v)=>Buffer.from(v,'base64url').toString('base64');console.log('AGENTFORGE_LAUNCH_SIGNING_KEY='+b(k.d)+'\nAGENTFORGE_LAUNCH_VERIFY_KEY='+b(k.x))" >> /opt/agentforge-week1/.env
```

Both values are base64 of 32 bytes (the private seed and the public key);
`openemr` refuses to launch if the two do not match. Without the signing key
the launcher answers 503 "AgentForge launch is not configured". Recreate
`openemr` and `agentforge-w2` after setting or rotating them; rotating ends
every open launch session.

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
   # the launcher keypair ("Launcher signing key" above); live reads refuse to start without the verify key
   AGENTFORGE_LAUNCH_SIGNING_KEY=<base64 32-byte seed>
   AGENTFORGE_LAUNCH_VERIFY_KEY=<base64 32-byte public key>
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
3b. **Enable the module in OpenEMR** (once). The patient-menu item "Prepare for visit" appears only when the module is enabled: Admin → Modules → Manage Modules → AgentForge → Enable, or `UPDATE modules SET mod_active=1 WHERE mod_directory='oe-module-agentforge'`. On production it had been installed on 2026-09-17 but left disabled until 2026-09-26. The module's own API endpoints work either way.
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
   must say "Chart source: OpenEMR (live)". Run the "Lab report — clean
   digital PDF" sample: the scan answer's patient-record facts cite `openemr_record` for
   the medications (Lisinopril) and encounters (the blood-pressure
   follow-up); problems and allergies are **not** shown as facts but listed
   under "Needs review" as "could not be confirmed from OpenEMR" (the
   OpenEMR 8.0.0 finding below), and the badge reads "OpenEMR (live) · not
   confirmed: problems, allergies". "View source region" opens the stored
   PDF. A live briefing is qualified with "Problems could not be confirmed
   from OpenEMR" and "Allergies could not be confirmed from OpenEMR" (until
   step 7 is done) and "Notes were not read from OpenEMR"; the scan badge
   adds "not read: notes". Lisinopril shows "dose not available from this
   OpenEMR route" and, separately, "Lisinopril instructions/comment: 10 mg
   daily [seed:af-live]" (the seed's free-text `comments`). `/agentforge-w2/v1/traces` shows the scan's retrieval
   attempts with `adapter: openemr`. The public demo at `/agentforge-w2/`
   must still say "Chart source: synthetic fixture". The launch link works
   once: opening it again answers 401 "Launch link already used or
   expired" (relaunch from the patient menu). If the launcher says
   "Chart reads only", `grader` lacks `patients/docs` write or the uuid is not
   on the write allowlist; "enabled only for designated synthetic patients"
   means the uuid is not on `AGENTFORGE_LIVE_PATIENT_UUIDS` (or `openemr`
   was not recreated after the change). The page header must say "Live
   OpenEMR chart (synthetic patient)", and the address bar must not show the
   token after the page loads.

7. **Re-authorize the read client as a clinician** (fixes the empty
   problem and allergy lists, which are specific to the current `admin`
   grant; see the finding below). Needs the F-LIVE code deployed, because
   the script ships in the `agentforge-w2` image. David signs in; the
   operator runs the commands. Nothing prints a token or the client secret.
   1. *Find the registered redirect URI* (read-only; no secret column):
      ```sh
      docker compose --env-file /opt/agentforge-week1/.env exec -T mysql \
        sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb -uroot openemr -e "SELECT client_name, redirect_uri, grant_types, is_confidential, is_enabled, scope FROM oauth_clients WHERE client_id = \"$AGENTFORGE_OPENEMR_CLIENT_ID\""'
      ```
      (`AGENTFORGE_OPENEMR_CLIENT_ID` from `.env`.) Use one `redirect_uri`
      value exactly (several are separated by `|`). It does not need to
      load: the code is read from the address bar. Do **not** use a URI
      served by an app that redeems codes itself (for example the
      dashboard's `/dashboard/callback`, which belongs to another client).
      If no registered URI qualifies, stop: the client's `redirect_uri`
      must first gain an https URI that no application redeems codes on
      (a reviewed `UPDATE oauth_clients SET redirect_uri = …` for that
      `client_id`; OpenEMR matches it exactly). That is an OpenEMR
      configuration change and needs owner approval. `is_enabled` must be
      1. The `grant_types` column (`password|refresh_token` on 2026-09-18)
      is not checked for the code grant in this repo's OpenEMR code
      (`ClientRepository::validateClient`); that was not verified on the
      production 8.0.0 image, so an `unauthorized_client` error at the
      exchange means the column must include `authorization_code`.
   2. *Find `grader`'s `users.uuid`* (read-only), for `--expect-user-uuid`:
      ```sh
      docker compose --env-file /opt/agentforge-week1/.env exec -T mysql \
        sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb -uroot openemr -N -e "SELECT LOWER(INSERT(INSERT(INSERT(INSERT(HEX(uuid),9,0,\"-\"),14,0,\"-\"),19,0,\"-\"),24,0,\"-\")) FROM users WHERE username = \"grader\""'
      ```
   3. *Stop the service*. The running service caches the old refresh token
      in memory and writes it back to the file on its next refresh, which
      would overwrite the new grant:
      `docker compose --env-file /opt/agentforge-week1/.env stop agentforge-w2`.
      The helper refuses to run while `agentforge-w2` still answers on the
      Docker network (`SERVICE_RUNNING`).
   4. *Run the helper* in a one-off container with the service's env. It
      writes atomically (temp file + rename), which cannot replace the
      service's single-file bind mount, so mount the secrets **directory**
      and point the cache path into it:
      ```sh
      docker compose --env-file /opt/agentforge-week1/.env run --rm --no-deps \
        -v /opt/agentforge-week1/secrets:/run/agentforge-secrets \
        -e AGENTFORGE_OPENEMR_TOKEN_CACHE_PATH=/run/agentforge-secrets/openemr-token.json \
        agentforge-w2 node scripts/openemr-authorize-read-client.mjs \
        --authorize-url 'https://<canonical-host>/oauth2/default/authorize' \
        --redirect-uri '<registered redirect URI>' \
        --expect-user grader --expect-user-uuid '<uuid from 2>'
      ```
      (on production today, `<canonical-host>` is
      `dtstest.64.177.10.182.nip.io`). `--authorize-url` is required and
      must be the **public https** URL, because David's (phone) browser
      opens it; it is never derived from the token URL. The code exchange
      itself goes to the service's own `AGENTFORGE_OPENEMR_TOKEN_URL`, which
      on production is the Docker-internal `http://openemr/...` (see
      below). It refuses an authorize URL that is not https and any other
      plain-http token URL, then prints the authorize URL.
   5. *David:* open the URL, sign in on OpenEMR's OAuth login page as
      `grader`, leave every scope ticked, click **Authorize**. The browser
      lands on the redirect URI with `?code=…&state=…`; copy the whole
      address and send it to the operator at once.
   6. *Operator:* paste the whole URL at the prompt within 60 s (OpenEMR
      codes expire after a minute; a bare code is refused because `state`
      must be checked; on `invalid_grant`, re-run from 4). The helper
      exchanges the code with PKCE and the client secret, then checks who
      authorized: the id token's `sub` must equal the uuid from 2 (and its
      `preferred_username`, if present, `grader`). It prints only
      `Authorized user: grader match` or `MISMATCH`, and on a mismatch,
      a missing refresh token or a missing read scope it writes nothing.
      Otherwise it replaces `secrets/openemr-token.json` and prints the
      file's actual mode (`0600`).
   7. *Recreate the service* (a fresh container re-reads the new file; a
      plain restart may keep the old bind-mounted inode):
      `docker compose --env-file /opt/agentforge-week1/.env up -d --no-deps --force-recreate agentforge-w2`,
      then repeat runbook steps 5 (`/ready` 200) and 6 above. With the new grant the
      problems and allergies should come back from the scoped routes. Since
      E9c (2026-09-27) they are already read through fallback routes with
      the current grant (`/patient/{pid}/allergy`, and the unscoped
      `/medical_problem` filtered to the patient; `attempts: 2` in the
      coverage), so a new grant mostly removes the problem-list over-fetch.

The helper requests `openid offline_access api:oemr user/patient.rs
user/encounter.rs user/medical_problem.rs user/allergy.rs user/medication.rs`
(`--scope` overrides it). `user/document.rs` is dropped: notes are no longer
read. OpenEMR intersects the request with the client's registered scopes.

**Token URL transport.** Production's `AGENTFORGE_OPENEMR_TOKEN_URL` is the
Docker-internal `http://openemr/oauth2/default/token` (checked by the
coordinator on 2026-09-26, scheme and host only). `openemr` is the Compose
service name, so the refresh (client secret and refresh token) stays on the
Docker bridge network and never leaves the VM. That exact origin
(`INTERNAL_HTTP_TOKEN_ORIGIN` in `agentforge/src/openemrAdapter.js`: scheme
http, host `openemr`, port absent or 80, no credentials) is the only
plain-http token URL the service and the helper accept; any https URL is also
accepted. Any other http URL (`http://evil`, `http://openemr.evil`,
`http://openemr:8080`) is refused: live reads stay off (`/ready` 503,
`openemr_live_reads_not_configured`) and the log names
`AGENTFORGE_OPENEMR_TOKEN_URL (must be https)`. The `.env` examples above
show the public https form, which also works.

**Live mapping (F-LIVE).** A medication's dose reads "dose not available
from this OpenEMR route": the route returns `lists` rows, which have no dose
column, and does not join `lists_medication.drug_dosage_instructions`. The
row's free-text `comments` is shown separately as "instructions/comment",
not as a dose. Notes are not read: the document route needs a category `path`, lists one
category, and returns rows without patient identity (500 on production
without `path`), so `notes` is reported `not_requested`
(`openemr_notes_route_unavailable`) and the briefing is qualified with
`notes:not_requested`. Details in `W2_ARCHITECTURE.md` §3f.

**OpenEMR 8.0.0 finding (E9b, 2026-09-26, unresolved upstream behavior).**
Observed on production with the service's read token (user `admin`, scopes
include `user/medical_problem.rs` and `user/allergy.rs`):
`GET /apis/default/api/patient/{uuid}/medical_problem` and
`GET /apis/default/api/patient/{uuid}/allergy` return 200 `[]` for AF-LIVE-01
(pid 9) and for pid 7, though both have rows. The unscoped
`GET .../medical_problem` returns 14 rows across pids 2 to 9 and
`GET .../allergy` 9 rows, both including pid 9, and a `?puuid=` parameter is
ignored. `GET .../patient/9/allergy` (the numeric pid in the `:puuid` slot)
returns pid 9's row, and `GET .../patient/9/medical_problem` returns 500.
Encounters (`/patient/{uuid}/encounter`) and medications
(`/patient/{pid}/medication`) return the patient's rows; the document route
returns 500. Later the same day the empty answers were narrowed to
AgentForge's grant: the dashboard BFF gets rows from the same routes with
`grader`'s tokens, while AgentForge's refresh token was issued to `admin` on
2026-09-18 (step 7 re-authorizes it). AgentForge therefore treats an empty answer from the two
patient-scoped list routes as `unverified_empty`
(`error_class: openemr_scoped_list_empty`), not as a confirmed absence: the
briefing is qualified ("Problems could not be confirmed from OpenEMR",
reason `problems:unverified_empty`), the group is withheld, and the scan
answer lists it under needs review (`openemr_unconfirmed_empty`). The same
status applies on any live route that returns only other patients' rows
(`openemr_rows_for_other_patients_only`). Medications and encounters keep
`empty`, because their routes returned the patient's own rows and an empty
encounter list is a 404. The adapter does not use the numeric-pid route (it
works only because this build compares `:puuid` with the pid) and does not
fetch every patient's list to filter one (not minimum necessary). The fixture
path is unchanged.

## Patient dashboard port (`dashboard`)

The `dashboard` service (`dashboard/Dockerfile`) serves the React SPA and its
Fastify BFF at `/dashboard/` (Caddy `handle /dashboard/*`, both HTTPS site
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
# OpenEMR's effective PHP timezone, an IANA name (no default; how to read it: below)
DASHBOARD_OPENEMR_TZ=<iana-zone>
# Optional (defaults shown or empty)
DASHBOARD_OPENEMR_INTERNAL_URL=http://openemr
DASHBOARD_DEMO_PATIENTS=Demo A (data-rich)=<patient-uuid>,Demo B (deceased)=<patient-uuid>
```

**`DASHBOARD_OPENEMR_TZ` (required since W3 hardening H4; it had an unchecked
`America/Chicago` placeholder default).** It must equal the timezone OpenEMR's
PHP runs in, because the legacy rules the dashboard reproduces run in PHP
(`filterActiveIssues()` compares `strtotime(enddate) > strtotime('now')`; ages
use `date()`). OpenEMR picks that zone in `interface/globals.php:509-518`:
the `gbl_time_zone` global if non-empty, else php.ini `date.timezone`, else
PHP's default `UTC`; it then sets each MySQL session's `time_zone` to PHP's
offset, so MySQL's global or system zone does not decide it. Read both inputs
on the VM:

```sh
cd /opt/agentforge-week1/deploy/vultr
# 1. The OpenEMR global (empty output or an empty line = not set)
docker compose --env-file /opt/agentforge-week1/.env exec -T mysql \
  sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb -uroot openemr -N -e "SELECT gl_value FROM globals WHERE gl_name = \"gbl_time_zone\""'
# 2. PHP's own setting (Apache's mod_php loads the same php.ini as the CLI in this image)
docker compose --env-file /opt/agentforge-week1/.env exec -T openemr \
  php -r 'echo "date.timezone=", var_export(ini_get("date.timezone"), true), " effective=", date_default_timezone_get(), PHP_EOL;'
docker compose --env-file /opt/agentforge-week1/.env exec -T openemr php --ini
# Context only (not the deciding value): MySQL's zones and clocks
docker compose --env-file /opt/agentforge-week1/.env exec -T mysql \
  sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mariadb -uroot -N -e "SELECT @@global.time_zone, @@system_time_zone, NOW(), UTC_TIMESTAMP()"'
```

Rule: if query 1 prints a zone name, use it. Otherwise use the `effective=`
value from command 2 (the CLI never reads `gbl_time_zone`, so that value is
php.ini's `date.timezone`, or PHP's default `UTC` when php.ini leaves it
unset). Locally (2026-10-01) query 1 prints an empty line and command 2 prints
`date.timezone='UTC' effective=UTC` with `date.timezone` commented out in
`/etc/php85/php.ini`, so the local value is `UTC`. The BFF refuses to start without a valid IANA name, and Compose
refuses to interpolate this file (for every service) while the variable is
missing, so set it before the next `deploy.sh` run.

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
and a Langfuse outage does not change the synthetic response path. When the
three variables are set, `/ready` probes `GET <base>/api/public/health` and
answers 503 with `langfuse` in `failing` while it is down.
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
