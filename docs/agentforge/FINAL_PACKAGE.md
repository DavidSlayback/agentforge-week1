# Final package checklist

## Candidate identity

- Local branch: `afk/AF-08-resilience-foundation`
- Source of record: GitLab issue #1 and child issues #2–#16
- Current deployment evidence URL: `https://dtstest.64.177.10.182.nip.io/agentforge/`
- Current service commit: `1259fbb`; current proxy/config commit: `c3a63a3`
- The prior Railway URL remains historical checkpoint evidence, not current-candidate proof.
- Target deployment configuration must set `AGENTFORGE_AUTH_MODE=signed-demo`,
  `AGENTFORGE_SYNTHETIC_CONTEXT=true`, and a durable `AGENTFORGE_TRACE_PATH`.

## Gate matrix

| Gate | Current state | Final proof required |
| --- | --- | --- |
| Requirements/provenance | PASS with repository-provenance note | State that `REQUIREMENTS.md` is the transcribed brief inventory and the original PDF is not stored here. |
| Public URL/TLS | PASS on current Vultr hostname | Trusted HTTPS certificate and HTTP redirect read back on `dtstest.64.177.10.182.nip.io`. |
| Multi-turn browser agent | PASS on current Vultr HTTP candidate | Clean-browser briefing, follow-up, reset, partial, and blocked probe captured. |
| Auth/scope seam | PASS synthetic local | Signed-context expiry/mismatch/scope tests and deployed readback. |
| Provider lane | PASS failure-policy tests; vendor deferred | Keep deterministic default; do not add a vendor without owner decision. |
| Operations | PASS on current Vultr synthetic candidate | Dashboard, alerts, traces, and route matrix read back over the trusted HTTPS hostname. |
| Load/cost | Deployed load PASS; billing readback PASS; projections REVIEW | Vultr shows $1.36 account charges this month and $28.64 remaining credit; deployment-specific attribution and scale projections require owner review. |
| Contract closure | READY | Review `USER.md`, 90–180-second framing, and provenance wording. |
| Deployed scale | READY FOR OWNER REVIEW | Review current Vultr load/resource evidence in AF-17, including interaction latency/cache/deadline metrics. |
| Cost analysis | READY FOR OWNER REVIEW | Review account-level Vultr billing, resource readback, and 100/1K/10K/100K projections; do not attribute account charges solely to AgentForge. |
| Final readback | READY FOR OWNER REVIEW | Billing, clean-profile sign-off, and final owner approval remain. |
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
