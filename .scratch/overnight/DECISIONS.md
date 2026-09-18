# AgentForge AFK decisions and stop conditions

## Resolved for this local run

- David approved the migrated queue and authorized local implementation plus
  the Railway deployment mirror; no PR or merge is opened.
- The available `docs/agentforge/REQUIREMENTS.md` inventory is the working requirements source for this run. The original AgentForge PDF is not present; this is recorded as an evidence limitation, not silently treated as recovered source.
- AgentForge is synthetic forever: no real PHI, live clinical retrieval, or
  clinical write-back. The system should nevertheless implement production-like
  resilience and trust-boundary controls against synthetic data.
- The deterministic provider remains the default. A cheap live provider from
  the approved vendor list, possibly through OpenRouter, is deferred until the
  resilience/evaluation lanes are ready.
- David states the historical Composer credential has been rotated/revoked.
- Railway remains a synthetic demo deployment; no PHI enters the host, repo,
  prompts, logs, or external observability.
- Retention/deletion, redaction, least privilege, incident response, rollback,
  backup/restore, and credential rotation are required controls even though
  the data is synthetic.

## Unresolved / stop before advancing

- AF-02: canonical hostname, trusted certificate, redirect, and deployment verification.
- AF-04/AF-06: if the AFK implementation cannot provide trustworthy deterministic UI-flow tests, downgrade to HITL before dispatch.
- AF-08 onward: privacy/provenance/provider/operations decisions remain HITL;
  the implementation target is a production-like synthetic simulation, not a
  live PHI system.
