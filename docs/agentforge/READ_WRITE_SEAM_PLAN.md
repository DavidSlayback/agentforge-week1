# Read-only chart and synthetic writeback plan

## Objective

Make the permanent AgentForge safety boundary explicit in code: chart
retrieval is a read-only collaborator, while source-document ingestion,
derived observations, and clinician-confirmed action drafts are a separate
synthetic-only collaborator.

## Chosen shape

```text
AgentForgeService (stable facade)
├── PreVisitPreparation -> chartAdapter (GET-only fixture/live seam)
├── follow-up evidence  -> chartAdapter
└── W2 synthetic flows  -> writeback (local-only, absent in live mode)
```

`SimulatedOpenEMRAdapter` remains a compatibility composition for existing
tests and callers. The server composition root uses `FixtureAdapter` plus
`SyntheticWriteback` in synthetic mode, and `OpenEMRRestAdapter` plus no
writeback collaborator in live mode.

## Acceptance checks

- Existing 101-test baseline remains green, plus explicit seam tests.
- Fixture and live chart adapters expose no synthetic persistence methods.
- Live-mode source-document and clinical-action routes remain disabled.
- Synthetic source and action routes preserve their current response and
  authorization contracts.
- `git diff --check` passes and deployment identity is reverified if deployed.

## Non-goals

- No live OpenEMR writes.
- No PHI, hosted-provider, or production-readiness expansion.
- No separate persistence service or database migration.
- No route or response-contract redesign.
