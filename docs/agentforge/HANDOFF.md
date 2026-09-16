# AgentForge Stage 4 handoff

- Goal: Continue the AgentForge Clinical Co-Pilot work from the completed audit; Stage 4 is now documented and Stage 5 planning can begin.
- Scope and explicit exclusions: The current system is an OpenEMR substrate and demonstration deployment. No PHI, clinical write-back, or hosted LLM integration is authorized yet.
- Last verified at: 2026-09-16, America/Chicago.
- Current mechanism: Pinned OpenEMR and MariaDB Docker Compose services; AgentForge will remain read-only and clinician-reviewed unless a later decision explicitly changes that boundary.
- Completed:
  - Stage 1 local OpenEMR setup and setup documentation.
  - Stage 2 public Vultr deployment at https://64.177.10.182 using the pinned deployment Compose file.
  - Stage 3 audit in `docs/agentforge/AUDIT.md` covering security, performance, architecture, data quality, and compliance.
  - Stage 4 target user and use cases in `docs/agentforge/USERS.md`, with explicit justification for the conversational-agent shape.
  - Synthetic fixture corpus in `docs/agentforge/fixtures/clinical-cases.json`.
  - Deployment hardening commit `e582cb9`: removed Composer credential literals from active development Compose files, made production credentials required, and denied dependency metadata and `.env` files in the Apache source configs.
- Decisions and rationale:
  - The agent must not write to the EMR or silently alter chart text.
  - Evidence must be traceable with inline links and human-readable qualification when a claim cannot be verified.
  - Reconciliation merges the most recent value for each field since the last visit, records who did what, and never labels a value reassessed unless it was actually reassessed.
  - Retry policy is two retries plus a deadline, with meticulous success/failure observability. Local observability is preferred while the design is still being evaluated.
  - The physician must be told when required information or review is missing.
- Current local state: `main` is clean at the latest handoff commit; `origin/main` matches. Compose syntax and whitespace checks passed. The local container may report `setup_required` until its isolated demo database is initialized.
- Current remote or runtime state: Vultr host `64.177.10.182`; server-only secrets remain in `/opt/agentforge-week1/.env`. `mysql` and `openemr` are running and healthy. Readiness returned `status: ready` with database, filesystem, session, OAuth-key, and cache checks true. The deployed Compose file hash is `ca80b8303715cdd5bf0ae2456812b5a6f73ebc192b62d09cbbe7480034207b57`.
- Passed checks:
  - `docker compose config --quiet` passed for development, production, and Vultr Compose files.
  - Production Compose rejects missing required secrets.
  - No known Composer credential literal remains in the working tree.
  - Remote deployment was recreated and readiness was verified over HTTPS with `curl --insecure`.
- Pending checks:
  - Revoke/rotate the historical Composer credential; removing it from the working tree does not remove it from Git history.
  - Configure a real domain, trusted TLS, and HTTP-to-HTTPS redirect before any PHI use.
  - Define identity/session binding, retrieval authorization, local trace storage, retention/deletion, incident response, and BAA/provider decisions before hosted PHI processing.
  - Build and test the Stage 5 agent against the synthetic fixtures before any live-data trial.
- Blockers and owners: Credential revocation and infrastructure/provider compliance require David or the relevant account administrator. Stage 4 implementation can proceed locally with synthetic data.
- Open work in priority order:
  1. Review `docs/agentforge/USERS.md` against the Stage 4 hard gate and keep it as the source of truth.
  2. Create `ARCHITECTURE.md` from the audit and trace every planned capability to UC-1 through UC-5.
  3. Inspect the OpenEMR API/session implementation and select the narrowest read-only integration seam.
  4. Implement fixture-backed retrieval, reconciliation, evidence qualification, physician review, bounded retries, and local observability.
  5. Add tests for authorization, missing/unverified claims, duplicates, stale fields, timeout/deadline behavior, and retry accounting.
  6. Re-audit the new AgentForge layer and update the deployment only after the local gate passes.
- Exact next action: Start Stage 5 planning by deriving `ARCHITECTURE.md` from `AUDIT.md` and `USERS.md`, with a capability-to-use-case traceability table.
- Refresh commands and links:
  - `git log -1 --oneline` and `git ls-remote origin refs/heads/main`
  - `docker compose -f docker/development-easy-light/docker-compose.yml ps`
  - `ssh -i C:\Users\david\.ssh\agentforge-week1-vultr linuxuser@64.177.10.182 "docker compose -f /opt/agentforge-week1/deploy/vultr/docker-compose.yml --env-file /opt/agentforge-week1/.env ps"`
  - `ssh -i C:\Users\david\.ssh\agentforge-week1-vultr linuxuser@64.177.10.182 "curl --insecure https://localhost/meta/health/readyz"`
  - Public demonstration URL: https://64.177.10.182
- Branches, worktrees, and uncommitted artifact custody: Only `main`; no uncommitted files or additional worktrees. The server deployment bundle is external state under `/opt/agentforge-week1/deploy/vultr`.
- Mutation or approval boundaries: Repository commits and the requested redeploy are authorized. Do not load real PHI, revoke credentials, configure a provider/BAA, or enable write-back without explicit authorization and the required compliance decisions.
- Claims that may go stale: Public IP, container/image health, readiness, remote branch, and deployment hash are snapshots; refresh them with the commands above.
