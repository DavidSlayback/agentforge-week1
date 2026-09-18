# Final package checklist

## Candidate identity

- Local branch: `afk/AF-08-resilience-foundation`
- Source of record: GitLab issue #1 and child issues #2–#16
- Deployment URL to recheck: `https://agentforge-week1-production.up.railway.app`
- Final local candidate must be identified by its commit and deployment readback.
- Target deployment configuration must set `AGENTFORGE_AUTH_MODE=signed-demo`,
  `AGENTFORGE_SYNTHETIC_CONTEXT=true`, and a durable `AGENTFORGE_TRACE_PATH`.

## Gate matrix

| Gate | Current state | Final proof required |
| --- | --- | --- |
| Requirements/provenance | PASS with source-PDF limitation | State that `REQUIREMENTS.md` is the available brief inventory. |
| Public URL/TLS | PASS for prior Railway candidate | Re-run against the final deployed commit. |
| Multi-turn browser agent | PASS in prior external checkpoint; strengthened locally | Clean-browser briefing, follow-up, reset, and blocked probe. |
| Auth/scope seam | PASS synthetic local | Signed-context expiry/mismatch/scope tests and deployed readback. |
| Provider lane | PASS failure-policy tests; vendor deferred | Keep deterministic default; do not add a vendor without owner decision. |
| Operations | PASS local and prior Railway persistence | Final dashboard, alerts, traces, retention, and rollback readback. |
| Load/cost | PASS local synthetic measurements | Do not relabel local measurements as Railway capacity. |
| Submission package | READY | Link-current artifact review and owner sign-off. |
| Interview | DRAFT READY | Timed rehearsal against final evidence. |
| External communication | LOCAL DRAFT ONLY | Owner explicitly chooses publish or no-publish. |

## Final release stop conditions

Stop the release if the final URL is inaccessible, TLS requires a bypass, the
browser surface is single-shot, signed context is not enforced in the target
configuration, traces contain raw fixture content, any golden case fails, or a
document makes a live OpenEMR/PHI/provider/compliance claim.

## Owner sign-off wording

> I reviewed the final candidate, live URL readback, browser flow, evidence
> index, limitations, and non-claims. I approve this as a synthetic,
> read-only, evidence-bounded submission. I do not approve PHI, live OpenEMR,
> hosted-provider, clinical write-back, or external publication beyond the
> separately named decision below.

## Publication decision

Default state: **do not publish or contact external parties**. Keep the draft
local unless the owner separately approves recipients, timing, links, and exact
copy.
