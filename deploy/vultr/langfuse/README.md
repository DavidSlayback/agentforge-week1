# Private Langfuse deployment artifact

This directory describes a separate Langfuse v4.38.0 Compose project for the
existing Vultr VM. It is intentionally private and unactivated: the repository
contains image pins and placeholder configuration only, never server credentials
or trace data.

## Current VM capacity gate

The owner-controlled VM readback on 2026-09-19 is 2 vCPU, 3.8 GiB RAM, and 75
GiB disk. Langfuse's official Docker Compose guidance recommends at least 4
cores, 16 GiB RAM, and approximately 100 GiB storage for a VM deployment; see
the [official requirements](https://langfuse.com/self-hosting/deployment/docker-compose#start-a-new-instance-and-ssh-into-it).
The current VM has approximately 53 GiB free and the existing AgentForge
containers are healthy, but its total volume and CPU/memory are below the recommended
envelope. Do not
activate this stack on the shared VM until the owner chooses a larger VM or
explicitly accepts the demo-only resource risk and rollback plan.

## Boundary

- AgentForge remains synthetic-only, read-only, and clinician-reviewed.
- Langfuse receives only the redacted operational allowlist implemented by
  `observability/index.js`; prompts, generated text, chart fields, patient or
  clinician identifiers, source references, and credentials are not exported.
- The local redacted trace file remains authoritative. Langfuse outage must not
  change AgentForge response behavior or readiness.
- The Langfuse web UI and MinIO endpoints bind to VM loopback only. No Caddy
  route, public dashboard, or public object store is part of this artifact.

## Pinned images

The Langfuse web and worker images are pinned to the official `v4.38.0` release
manifest digests. ClickHouse, Postgres, Redis, and MinIO are also pinned to the
manifest digests read from their registries on 2026-09-19. Refresh these pins as
a deliberate dependency decision; do not silently replace them with floating
tags.

## Server-only preparation

1. Copy `.env.example` to a root-owned file on the VM, outside the repository.
2. Replace every `REPLACE_WITH_*` value. `DATABASE_URL` must contain the URL-
   encoded Postgres password and must match `POSTGRES_PASSWORD`.
3. Use a different random value for each secret. Keep the Langfuse init project
   keys aligned with the AgentForge `LANGFUSE_PUBLIC_KEY` and
   `LANGFUSE_SECRET_KEY` values in the main deployment environment.
4. Validate the file without printing it:

   ```sh
   docker compose --env-file /root/agentforge-langfuse.env \
     -f /path/to/repo/deploy/vultr/langfuse/docker-compose.yml config >/tmp/agentforge-langfuse.config
   ```

## Activation sequence (not run by preparing this artifact)

The main AgentForge Compose project creates the shared network automatically. If
this project is started first, create the network with the guarded command below.

Run only after the VM identity, disk/memory capacity, backup/retention decision,
and operator authorization are confirmed:

```sh
docker network inspect agentforge-observability >/dev/null 2>&1 || \
  docker network create agentforge-observability
docker compose --env-file /root/agentforge-langfuse.env \
  -f /path/to/repo/deploy/vultr/langfuse/docker-compose.yml up -d
```

Then add these values to the server-only `.env` used by the main AgentForge
Compose project, without committing them:

```dotenv
LANGFUSE_BASE_URL=http://langfuse-web:3000
LANGFUSE_PUBLIC_KEY=<same-as-LANGFUSE_INIT_PROJECT_PUBLIC_KEY>
LANGFUSE_SECRET_KEY=<same-as-LANGFUSE_INIT_PROJECT_SECRET_KEY>
LANGFUSE_TIMEOUT_MS=3000
LANGFUSE_MAX_PENDING_EXPORTS=16
```

The main Compose project must join the same network before the AgentForge
container can resolve `langfuse-web`. Recreate only the AgentForge service after
the values are present. Verify locally on the VM with `curl` or an SSH tunnel to
`127.0.0.1:3000`; do not expose the port through Caddy as part of this step.

## Rollback

Disable the AgentForge Langfuse variables and recreate the AgentForge service;
its local redacted trace sink remains usable. Stop the separate Langfuse project
only after preserving any operator-required evidence. Do not remove named
volumes as part of an ordinary rollback.
