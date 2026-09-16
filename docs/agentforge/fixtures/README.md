# AgentForge audit fixtures

These fixtures are synthetic and are intended for local adapter/evaluation tests only. They are not OpenEMR import data and must never be loaded into the public Vultr deployment.

The corpus is deliberately normalized around the AgentForge evidence contract. Each case defines source records, retrieval outcomes, and the expected disposition. The adapter/evaluator should preserve the source identifier, recorded date, author, and whether reassessment was explicitly documented.

Cases:

- `complete_return_visit`: normal multi-source return-visit context.
- `duplicate_identity`: two identity records that must be flagged, not silently merged.
- `conflicting_latest_values`: same-field values at the latest date from different authors; withhold the unresolvable field.
- `stale_field`: the most recent available value predates the current visit and must be labeled stale.
- `missing_provenance`: a value exists without an author; retain it as qualified evidence.
- `unstructured_note`: narrative chart text that is evidence, not agent instructions.
- `partial_retrieval`: successful, empty, failed, and timed-out coverage groups; produce a partial brief with a heavily qualified missing-data panel.

Expected behavior is part of each case so tests can assert withholding and qualification decisions without relying on an LLM judge.
