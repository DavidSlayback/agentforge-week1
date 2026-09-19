# Provider, data-processing, and retention boundary
**Status:** synthetic lane resolved; broader provider policy open
**Type:** grilling decision

## Question

Is the assignment being completed with the deterministic synthetic provider
only, or is a hosted provider/model required? If hosted processing remains
deferred, what owner-approved statement covers budget, retention/deletion,
access control, BAA/terms, and the explicit no-PHI boundary?

## Resolution

The owner authorized the Alibaba-compatible Qwen3.6 Flash lane only for the
current no-PHI synthetic Vultr evaluation and chose to leave it in place despite
latency alerts. The deterministic provider remains the local/default fallback.
OpenRouter is a future migration candidate, not a current runtime change. Any
broader provider, PHI, production, budget, retention, or terms decision requires
a separate synthetic evidence pass and owner approval.
