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
the authenticated session's `pid` and creates a five-minute signed context. The
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
(`read_path: openemr-fhir-service-in-process`); the `/fhir` HTTP API remains
disabled on this deployment (`rest_fhir_api=0`) and is not what this proves.

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

## Prepared Jev shadow lane

The Jev seam is prepared as an optional, server-only typed-evidence review
lane. It is downstream of OCR/VLM extraction and evidence retrieval; it is not
the image reader and it does not receive raw documents or images. The
application-owned deterministic supervisor and safety guard remain
authoritative. The current release leaves the lane off:

```dotenv
AGENTFORGE_JEV_MODE=off
JEV_ENDPOINT=https://www.jevai.org/api/v1/decisions
JEV_MODEL=typesafe-ai/jev
JEV_API_KEY=<server-only-jev-key>
```

These values belong only in the server-side `/opt/agentforge-week1/.env` file.
The repository contains no Jev credential, and adding `JEV_API_KEY` does not
activate a call. `AGENTFORGE_JEV_MODE` is currently a reserved deployment
setting; the public AgentForge service does not yet read it or invoke the Jev
adapter. The local Jev adapter source rejects requests unless the mode is
explicitly `shadow` and accepts only the documented Jev HTTPS endpoint before
attaching the bearer key; that adapter is not part of the current public
container path. A future shadow run requires explicit owner authorization,
the same synthetic labeled corpus as the deterministic baseline, redacted
readback, and an outcome report covering quality, safety, traceability,
latency, and cost. Do not send PHI, raw scans, or live OpenEMR data to Jev.

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
