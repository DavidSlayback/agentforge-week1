# Final package checklist

> Current submission package for the synthetic checkpoint. The video remains
> the only intentionally unfinished artifact; OpenRouter migration is deferred
> by owner direction.

## Candidate identity

- Local branch: `davidslayback/agentforge-stack-03-deploy-evidence`
- Source of record: GitLab program issue #17 and child issues #18–#26
- Verified deployment URL: `https://dtstest.64.177.10.182.nip.io/agentforge/`
- Deployed service commit: `8203ca6`; image manifest:
  `sha256:b9503b2934648ea57b353ab13ee1deb933ac79eb155e69b0652920e0ae77b428`
- Active provider: Qwen. OpenRouter is configured as a dormant mode only and
  was not called.
- A future synthetic deployment must set `AGENTFORGE_SYNTHETIC_CONTEXT=true`, a
  server-only `AGENTFORGE_DEMO_SECRET`, and a durable `AGENTFORGE_TRACE_PATH`.

## Gate matrix

| Gate | Current state | Final proof required |
| --- | --- | --- |
| Requirements/provenance | PASS with repository-provenance note | State that `REQUIREMENTS.md` is the transcribed brief inventory and the original PDF is not stored here. |
| Public URL/TLS | PASS | Current HTTPS URL, redirect, health, readiness, and browser surface read back on the packaged revision. |
| Multi-turn browser agent | PASS synthetic | Current clean-browser briefing/follow-up surface verified; partial and blocked probes are in the API collection and UI. |
| Auth/scope seam | PASS synthetic local; deployment pending | Signed-context expiry/mismatch/scope tests pass locally; the B revision needs deployed readback. |
| Provider lane | PASS Qwen synthetic | Qwen remains active; deterministic fallback and dormant OpenRouter mode are documented. |
| Operations | PASS synthetic | Dashboard, alerts, traces, and route matrix read back on the packaged revision. |
| Load/cost | Deployed load PASS; billing readback PASS; projections REVIEW | Vultr shows $1.36 account charges this month and $28.64 remaining credit; deployment-specific attribution and scale projections require owner review. |
| Contract closure | READY | Review `USER.md`, 90–180-second framing, and provenance wording. |
| Deployed scale | PARTIAL | Current Qwen smoke evidence is 10/10 at concurrency 10 and 47/50 at concurrency 50; tail latency remains the named limitation. |
| Cost analysis | READY FOR OWNER REVIEW | Review account-level Vultr billing, resource readback, and 100/1K/10K/100K projections; do not attribute account charges solely to AgentForge. |
| Final readback | PASS synthetic | Candidate `8203ca6` is deployed, healthy, and passed the public API collection plus clean-browser UI readback. |
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
