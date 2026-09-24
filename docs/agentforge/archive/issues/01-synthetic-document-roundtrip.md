# 01: Synthetic document round-trip

**Type:** AFK

**What to build:** A complete synthetic document lifecycle for either required
document type: associate the upload with a synthetic patient, persist the source
document in OpenEMR, read it back, and expose a stable provenance-bearing result
to the AgentForge workflow.

**Blocked by:** None (can start immediately)

**Status:** accepted-with-residual

- [x] A synthetic patient can upload a lab PDF or intake form through the supported synthetic product path.
- [ ] The source document persists in real OpenEMR and can be read back through that integration boundary. The synthetic adapter/service roundtrip is proven; live OpenEMR remains an explicit residual.
- [x] Repeating the same upload is idempotent and does not create duplicate source records.
- [x] The result identifies the synthetic patient, source document, ingestion revision, and synthetic-roundtrip provenance without exposing raw document content in metadata.
- [x] API, UI, and contract tests cover success, retry, wrong-patient, persistence-failure handling, and the live-mode refusal boundary.

## Verification

- Targeted source-document/contract/UI tests: `72/72`.
- Full AgentForge suite: `72/72`.
- Syntax checks: `node --check` passed for changed JavaScript modules.
- Review residual: the in-memory `SimulatedOpenEMRAdapter` is a local synthetic seam; no claim is made that it proves the real OpenEMR document route or derived-observation roundtrip.
