# AgentForge AFK checkpoint

**State:** `HITL_REVIEW` at AF-16/AF-18; AF-08 is signed off, AF-09 through AF-12 have local synthetic evidence, and AF-17/AF-18 have current Vultr deployed and billing evidence. Trusted HTTPS is now read back.

## Completed

- Queue migration approved by David.
- AF-01 requirements/evidence gate recorded as approved for implementation using `docs/agentforge/REQUIREMENTS.md` as the repository-stored transcribed inventory; the original brief PDF is not stored in this repository and must be described that way.
- Existing repository tests confirmed: AgentForge 5/5, evals 10/10, observability 5/5.
- AF-02 canonical Railway HTTPS origin externally verified at `https://agentforge-week1-production.up.railway.app`; route matrix and fresh-browser interaction passed.
- AF-06 evaluator/operations panel externally verified at the same origin; saved golden and mutation evidence are discoverable and all linked routes passed.
- AF-07 owner sign-off recorded after a fresh-browser rehearsal: briefing, follow-up, blocked cross-patient probe, evaluator evidence, operational links, and synthetic-only limitations all passed.
- AF-08 decision inputs recorded: synthetic forever, no PHI, provider deferred, and production-like resilience required; owner sign-off is recorded.
- AF-09 through AF-12 local continuation: signed synthetic context, provider retry/fallback, operational dashboard/trace persistence, and 10/50 concurrency load evidence are implemented and tested.
- AF-08 resilience foundation tested locally and deployed: durable redacted traces, retention/deletion, backup/restore, alert evaluation and readback, a bounded synthetic incident drill, isolated evaluator state, Railway rollback/redeploy readback, attached-volume redeploy persistence, public route smoke, and API collection pass. Cross-region durability, off-host backup/restore, external notification delivery, and secret-manager readback remain future production-like work; independent review is not claimed or required.
- 2026-09-18 local regression gate: AgentForge 20/20, observability 9/9, evals 10/10, and Vultr Compose configuration validation passed with required dummy interpolation values; no deployment claim was made.
- 2026-09-18 current-candidate deployment: commit `1259fbb` was rebuilt directly on Vultr. The `/agentforge` route, fresh browser flow, evaluator links, interaction-specific observability fields, health/readiness, and 10/50 deployed load runs passed; trusted HTTPS and billing readback are now recorded.
- 2026-09-18 billing readback: authenticated Vultr Billing shows $1.36 charges this month and $28.64 remaining credit. This is account-level spend, not deployment-attributed spend; projection review remains open.
- 2026-09-18 trusted HTTPS readback: `https://dts-agentforge.64.177.10.182.nip.io/agentforge/` loaded in Chrome with a trusted Caddy-managed certificate; HTTP redirected to HTTPS.

## Active plan

1. Close AF-16 documentation/claim consistency.
2. Review AF-17 deployed scale and AF-18 account-level billing/projection evidence.
3. Complete final readback, interview rehearsal, and no-publish decision through AF-19–AF-15.

## Recovery action

Read `QUEUE.md`, `STACK.md`, this file, the ticket evidence files, and `DECISIONS.md`; inspect `git status --short --branch`; resume at AF-18 billing readback, then trusted HTTPS/final readback.
