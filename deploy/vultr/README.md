# Vultr deployment

This Compose file is suitable for the public synthetic AgentForge checkpoint
demonstration only. It is not approved for real patient data.

## Required secrets

Create a server-only `.env` beside `docker-compose.yml`:

```dotenv
MYSQL_ROOT_PASSWORD=<long-random-value>
MYSQL_USER=openemr
MYSQL_PASSWORD=<long-random-value>
OE_USER=admin
OE_PASSWORD=<long-random-value>
AGENTFORGE_DEMO_SECRET=<long-random-value>
AGENTFORGE_SERVICE_URL=https://<canonical-host>/agentforge
```

Do not commit this file. Start with `docker compose up -d --build` and verify
both OpenEMR readiness and `http://<host>:8787/ready` before using the instance.

AgentForge is currently a separate service beside OpenEMR. Caddy owns the
public 80/443 entrypoints and routes `/agentforge` to the service while routing
the root path to OpenEMR. The module launcher creates a five-minute signed
synthetic context and hands off to the configured public HTTPS base URL; it is
not itself an authorization mechanism. The real OpenEMR session-bound adapter
remains a final-deadline requirement before PHI.

## Optional approved live-provider lane

The deterministic provider remains the default. After an owner-approved
OpenRouter/data-processing decision, configure these server-only values in the
same `.env` file and redeploy the AgentForge service:

```dotenv
AGENTFORGE_MODEL_ENDPOINT=https://openrouter.ai/api/v1/chat/completions
AGENTFORGE_MODEL=openrouter/free
AGENTFORGE_MODEL_API_KEY=<server-only-openrouter-key>
AGENTFORGE_MODEL_SITE_URL=https://<canonical-host>/agentforge
AGENTFORGE_MODEL_SITE_NAME=AgentForge
AGENTFORGE_MODEL_TIMEOUT_MS=8000
```

The service retries the live provider and rejects output that is empty,
overlong, ungrounded in an exact retrieved field/value pair, or contains
clinical action language. It then falls back to the deterministic provider.
The key must never enter the repository, browser URL, traces, or prompt data.

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

The AgentForge audit remains the source of truth for the unresolved provider,
identity, observability, and compliance gates.
