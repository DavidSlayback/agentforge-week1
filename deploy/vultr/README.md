# Vultr deployment

This Compose file is suitable for the public Stage 2 demonstration only. It is
not approved for real patient data.

## Required secrets

Create a server-only `.env` beside `docker-compose.yml`:

```dotenv
MYSQL_ROOT_PASSWORD=<long-random-value>
MYSQL_USER=openemr
MYSQL_PASSWORD=<long-random-value>
OE_USER=admin
OE_PASSWORD=<long-random-value>
```

Do not commit this file. Start with `docker compose up -d` and verify the
readiness health check before using the instance.

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
