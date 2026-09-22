# Pre-visit preparation module extraction

Status: complete

## Outcome

Extract the briefing lifecycle from `agentforge/src/service.js` into a deep `PreVisitPreparation` module while preserving the existing `AgentForgeService` facade, HTTP contracts, patient scope rules, response dispositions, trace behavior, cache semantics, and verification safety gate.

## Scope

In scope:

- `prepare`, `prewarm`, `openPrepared`, and `followUp` ownership.
- Existing retrieval, provider, verifier, trace sink, deadline, and cache collaborators.
- Behavior-focused tests at the new module interface plus facade contract coverage.
- ADR and architecture documentation.

Out of scope:

- Source-document ingestion or extraction.
- Clinical-action drafting or confirmation.
- Evidence-only retrieval and supervisor workflow redesign.
- New cache or trace adapters.
- Response-schema, route, provider, deployment, or synthetic/read-only policy changes.

## Settled decisions

- Canonical domain term: `Pre-visit preparation` from `CONTEXT.md`.
- Stable facade: `AgentForgeService` remains the caller-facing module.
- Deep module: `PreVisitPreparation` owns the briefing lifecycle.
- Authorization remains inside the deep module before retrieval, cache use, or synthesis.
- Synthesis and cache writes occur only after retrieval validation and evidence verification pass.
- Existing cache binding, stale refresh, prewarm deduplication, and six-entry history cap remain unchanged.
- Existing provider and chart-retrieval seams are reused; cache and tracing remain injected collaborators without new adapters.
- One bounded behavior-preserving extraction; no duplicate policy path.

## Implementation slices

1. Add `agentforge/src/preVisitPreparation.js` with the selected lifecycle implementation and private helpers.
2. Make `AgentForgeService` delegate the four lifecycle methods while retaining unrelated workflows and the stable facade method surface.
3. Move or add tests at the `PreVisitPreparation` interface for complete, qualified, blocked, stale-cache, prewarm, follow-up, deadline, verification, and provider-failure behavior.
4. Retain HTTP/facade contract tests and remove only tests that assert extracted internal structure.
5. Update `docs/agentforge/ARCHITECTURE.md` and run the documented AgentForge test commands.

## Acceptance evidence

- Full `agentforge` test suite passes.
- Existing HTTP contract tests pass without route or response changes.
- Verification failure proves no provider synthesis and no cache write.
- Patient/clinician mismatch and stale-cache refresh retain current outcomes.
- Prewarm deduplication/capacity and follow-up history retain current outcomes.
- `git diff --check` passes and only scoped files change besides the pre-existing scratch edit.

## Stop conditions

Stop and report `INCONCLUSIVE` if the extraction requires changing response contracts, synthetic/read-only policy, patient authorization semantics, or external deployment state; if baseline behavior cannot be established; or if a test failure cannot be attributed to this change.

## Completion record

- **Changed:** Added `agentforge/src/preVisitPreparation.js`; reduced
  `AgentForgeService` to a stable facade for the extracted lifecycle; added
  direct module safety/lifecycle tests; recorded ADR-020 and updated the
  architecture and planning documents.
- **Verified:** `npm.cmd test` in `agentforge` passed **101/101**; changed
  JavaScript syntax checks passed; `git diff --check` passed.
- **Preserved:** Existing route and response contracts, patient scope,
  verification-before-synthesis/cache, stale refresh, prewarm bounds, and
  synthetic/read-only policy.
- **Remaining risk:** No external deployment or provider behavior was changed
  or claimed. The pre-existing scratch-file edit remains untouched.
- **Next action:** Review the scoped diff; no push, PR, or deployment was
  requested or performed.
