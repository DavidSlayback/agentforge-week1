# Final package checklist

## Candidate identity

- Local branch: `afk/AF-08-resilience-foundation`
- Source of record: GitLab program issue #17 and child issues #18–#26
- Historical deployment evidence URL: `https://dtstest.64.177.10.182.nip.io/agentforge/`
- Historical deployed service commit: `1259fbb`; historical proxy/config commit: `c3a63a3`
- The local B authorization revision is newer than those deployed commits and has not been redeployed; the URL is not current-candidate proof.
- The prior Railway URL remains historical checkpoint evidence, not current-candidate proof.
- A future synthetic deployment must set `AGENTFORGE_SYNTHETIC_CONTEXT=true`, a
  server-only `AGENTFORGE_DEMO_SECRET`, and a durable `AGENTFORGE_TRACE_PATH`.

## Gate matrix

| Gate | Current state | Final proof required |
| --- | --- | --- |
| Requirements/provenance | PASS with repository-provenance note | State that `REQUIREMENTS.md` is the transcribed brief inventory and the original PDF is not stored here. |
| Public URL/TLS | Historical evidence | Trusted HTTPS certificate and HTTP redirect were read back on the historical Vultr candidate; refresh against the packaged revision. |
| Multi-turn browser agent | Historical evidence | Clean-browser briefing, follow-up, reset, partial, and blocked probe exist for the older candidate; refresh against the packaged revision. |
| Auth/scope seam | PASS synthetic local; deployment pending | Signed-context expiry/mismatch/scope tests pass locally; the B revision needs deployed readback. |
| Provider lane | PASS failure-policy tests; vendor deferred | Keep deterministic default; do not add a vendor without owner decision. |
| Operations | Historical evidence | Dashboard, alerts, traces, and route matrix were read back over the older trusted HTTPS candidate; refresh against the packaged revision. |
| Load/cost | Deployed load PASS; billing readback PASS; projections REVIEW | Vultr shows $1.36 account charges this month and $28.64 remaining credit; deployment-specific attribution and scale projections require owner review. |
| Contract closure | READY | Review `USER.md`, 90–180-second framing, and provenance wording. |
| Deployed scale | Historical evidence; refresh pending | Review the older Vultr load/resource evidence in AF-17 only after reconciling it to the packaged revision. |
| Cost analysis | READY FOR OWNER REVIEW | Review account-level Vultr billing, resource readback, and 100/1K/10K/100K projections; do not attribute account charges solely to AgentForge. |
| Final readback | READY FOR OWNER REVIEW | Billing, clean-profile sign-off, and final owner approval remain. |
| Submission package | READY | Link-current artifact review and owner sign-off. |
| Interview | READY FOR OWNER REVIEW | Timed rehearsal against final evidence. |
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
