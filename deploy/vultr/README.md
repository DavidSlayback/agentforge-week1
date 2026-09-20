# Vultr deployment

This Compose file is suitable for the public synthetic AgentForge checkpoint
demonstration only. It is not approved for real patient data.

The current owner-controlled VM is reached as `linuxuser@64.177.10.182` with
the local private key `C:\Users\david\.ssh\agentforge-week1-vultr`. The remote
deployment root is `/opt/agentforge-week1`; its `.env` is server-only and is not
part of the repository.

## Required secrets

Create a server-only `.env` beside `docker-compose.yml`:

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
persists rotation of the refresh token there. Start with
`docker compose up -d --build` and verify both OpenEMR readiness and
`http://<host>:8787/ready` before using the instance.

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

## Dormant OpenRouter mode

The provider seam also supports an OpenAI-compatible OpenRouter lane. Keep it
dormant by leaving `AGENTFORGE_PROVIDER_MODE=qwen`; the active Qwen lane is
unchanged. Configure these values only in the server-side root `.env` when the
final provider switch is authorized:

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

## Optional split provider lanes

For a calendar-driven workflow, keep the synthesis lane on Qwen and opt into a
separate low-cost conversation lane only after it has been funded and tested.
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
