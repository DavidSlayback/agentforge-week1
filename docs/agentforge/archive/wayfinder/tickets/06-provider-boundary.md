# Provider, data-processing, and retention boundary
> **Archived (2026-10-01).** A 2026-09-19 Wayfinder decision ticket, kept as history. It was superseded by [`PLAN.md`](../../../PLAN.md), not resolved here; the status below is as of that date.

**Status:** synthetic lane resolved; broader provider policy open
**Type:** grilling decision

## Question

Is the assignment being completed with the deterministic synthetic provider
only, or is a hosted provider/model required? If hosted processing remains
deferred, what owner-approved statement covers budget, retention/deletion,
access control, BAA/terms, and the explicit no-PHI boundary?

## Resolution

The owner authorized the Alibaba-compatible Qwen3.6 Flash lane for ahead-of-visit
synthesis and the OpenRouter Gemini Flash-Lite lane for short follow-ups, both
for the current no-PHI synthetic Vultr evaluation. The deterministic provider
remains the local/default fallback. Any broader provider, PHI, production,
budget, retention, or terms decision requires a separate synthetic evidence pass
and owner approval.
