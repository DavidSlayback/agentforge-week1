# ADR-0002: Separate chart retrieval from synthetic write-back

- Status: accepted
- Date: 2026-09-22
- Scope: AgentForge service composition and adapter boundaries

## Decision

Compose the service from two explicit collaborators:

1. `chartAdapter` — the read-only fixture or live OpenEMR chart seam. It may
   authorize, resolve a patient case, check readiness, and retrieve the
   allowlisted chart groups. It has no source-document, observation, or
   clinical-action persistence methods.
2. `writeback` — the synthetic-only local persistence seam for source
   documents, derived observations, and clinician-confirmed action drafts.
   It is absent in live OpenEMR mode.

`AgentForgeService` remains the stable caller-facing facade. Its legacy
`adapter` constructor form and `SimulatedOpenEMRAdapter` are retained as
compatibility shims while new composition uses the explicit collaborators.

## Why

The previous composition placed chart reads and synthetic persistence on the
same adapter object. That made capability checks implicit and allowed a
synthetic write method to appear adjacent to the live chart integration seam.
The explicit split makes the permanent read-only boundary visible in the
composition root and makes live mode structurally unable to receive the
synthetic writeback collaborator.

## Invariants

- Live OpenEMR chart integration remains GET-only.
- No writeback collaborator is constructed in live mode.
- Synthetic writeback remains local, synthetic, and clinician-confirmed where
  applicable; it is not represented as live OpenEMR writeback.
- Existing routes, response contracts, authorization checks, and fixture
  behavior remain unchanged.
- The service facade may delegate to both collaborators, but preparation and
  follow-up retrieval use only `chartAdapter`.

## Alternatives rejected

- Keep one mixed adapter and rely on optional-method checks: rejected because
  the safety boundary remains implicit and every caller must remember the
  capability matrix.
- Split every store into a separate service now: rejected as premature; the
  current cohesive synthetic writeback module is one bounded implementation.
- Remove the compatibility facade immediately: rejected because it would
  widen the change surface without improving the current runtime contract.

## Evidence

- `agentforge/src/syntheticWriteback.js`
- `agentforge/src/service.js`
- `agentforge/src/server.js`
- `agentforge/test/architecture-seams.test.js`
- Full AgentForge suite and live-mode write-disable regression tests.
