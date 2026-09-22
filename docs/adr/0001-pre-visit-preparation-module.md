# Pre-visit preparation as a deep module

Status: accepted

Keep `AgentForgeService` as the stable caller-facing facade, but extract its briefing lifecycle into a `PreVisitPreparation` module owning preparation, prewarm, cache opening, and follow-up. The module keeps authorization, retrieval, qualification, synthesis, verification, tracing, deadlines, and cache policy behind its interface; source-document work, clinical actions, evidence-only retrieval, and supervisor workflow remain outside. Preserve existing response contracts and safety behavior, and do not add new cache or tracing adapters because those seams have only one implementation in this checkpoint.

## Consequences

- Tests target the deep module interface while facade tests preserve HTTP-facing behavior.
- Patient/clinician scope, verification-before-synthesis, and qualified partial results remain centralized.
- The extraction is behavior-preserving; no route or response migration is required.
