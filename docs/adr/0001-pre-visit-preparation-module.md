# Pre-visit preparation as a deep module

Status: accepted
Date: 2026-09-22

Keep `AgentForgeService` as the stable caller-facing facade, but extract its briefing lifecycle into a `PreVisitPreparation` module owning preparation, prewarm, cache opening, and follow-up. The module keeps authorization, retrieval, qualification, synthesis, verification, tracing, deadlines, and cache policy behind its interface; source-document work, clinical actions, evidence-only retrieval, and supervisor workflow remain outside. Preserve existing response contracts and safety behavior, and do not add new cache or tracing adapters because those seams have only one implementation in this checkpoint.

## Consequences

- Tests target the deep module interface while facade tests preserve HTTP-facing behavior.
- Patient/clinician scope, verification-before-synthesis, and qualified partial results remain centralized.
- The extraction is behavior-preserving; no route or response migration is required.

## Tradeoffs and limitations

- The stable facade remains as a compatibility surface, so the module is
  deeper without removing the older caller entry point.
- Cache and tracing remain injected collaborators because this checkpoint has
  only one implementation of each; extracting them would add indirection
  without a second concrete boundary to justify it.
- Source-document, clinical-action, evidence-only, and supervisor workflows
  remain outside this module and are not made part of the preparation API.

## Migration path

New callers should use the stable `AgentForgeService` facade or the direct
`PreVisitPreparation` interface when they need the briefing lifecycle. A
future calendar trigger can call `prewarm` and later `openPrepared` without
reaching into retrieval, verification, cache, or provider internals. The
follow-on read/write boundary is recorded separately in ADR-0002.

## Evidence

- `agentforge/src/preVisitPreparation.js`
- `agentforge/test/pre-visit-preparation.test.js`
- `docs/agentforge/PRE_VISIT_PREPARATION_PLAN.md`
- Full AgentForge suite: 101/101 at the first implementation checkpoint;
  103/103 after the follow-on architecture seam.
