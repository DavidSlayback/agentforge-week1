# AgentForge Week 2 architecture checkpoint

Status: local synthetic evidence checkpoint with an agreed local-VLM lane, 2026-09-22.

## Flow

```text
source form (synthetic fixture or approved public blank form)
  -> source document stored: OpenEMR via oe-module-agentforge (W2 service),
     or the in-memory synthetic store (default mode)
  -> scan-form extraction worker
     (Tesseract/deterministic baseline, then optional larger local VLM crop resolver)
     (inspect -> extract -> validate/qualify)
  -> evidence retrieval worker
     (inspect -> formulate -> retrieve/check -> qualify)
  -> inspectable active supervisor
  -> cited READY or qualified/blocked result
```

The existing standard supervisor and deterministic extraction/tool path remain
the safety baseline for the clinical co-pilot. The active path is a bounded
multi-worker document/evidence seam and does not write clinical actions. The
local VLM adapter is opt-in, typed, crop-bounded, and fail-closed when no local
model runner is configured or measured. The eventual API/managed provider can
replace this runner without changing the worker contract. The separate
`write-clinical-action` lane still
requires explicit clinician confirmation and remains synthetic-only.

## OpenEMR persistence (S8)

With `AGENTFORGE_PERSISTENCE_MODE=openemr-module` (set for `agentforge-w2` in
Compose) the service calls `oe-module-agentforge/public/api.php` on the internal
network with HMAC-signed requests. On upload the source is stored as an OpenEMR
document ("Lab Report" or "Medical Record"). After a validated extraction the
service stores a derived-facts JSON document linked to the source and, for a lab
PDF, one `procedure_order`/`_report` plus one `procedure_result` per LOINC-mapped
result (`718-7` hemoglobin, `4548-4` A1c; others are reported as unmapped). It
then reads the results back as FHIR Observations and requires every value to
match. A write ledger keyed by patient and content hash makes re-uploads return
the same ids with `duplicate: true` and zero new rows. Public demo writes are
limited to the allowlisted synthetic patient and recorded with issuer
`synthetic-demo`. Clinician-confirmed intake medications and allergies have a
module route, but the service's clinical-action lane does not call it yet.

Known gaps: the lab read-back uses OpenEMR's FHIR Observation service
**in-process** (`read_path: openemr-fhir-service-in-process`), not the `/fhir`
HTTP API, which is disabled on the deployment (`rest_fhir_api=0`) and would need
an interactive OAuth grant with `api:fhir user/Observation.rs`. The live
round-trip is unverified until `agentforge/scripts/w2-openemr-smoke.mjs` passes
on the deployed SHA.

## Evidence and retrieval

Observed fields carry a `w2-scan-v1` citation with source document, page, field,
quote, layout, and bounding box. Missing, unreadable, low-confidence, and
conflicting values are represented as qualification metadata and are not
promoted to facts. Guideline evidence is returned separately from patient
facts. The local retrieval choice is the existing deterministic sparse plus
dense-proxy index because the fixed synthetic benchmark is replayable, cited,
and zero-cost; `dense_score` is not a true embedding score.

## Evaluation and observability

The 50-case gate retains its seven behavioral labels and now emits an explicit
mapping to `schema_valid`, `citation_present`, `factually_consistent`,
`safe_refusal`, and `no_phi_in_logs`. Worker handoffs expose step decisions and
redacted metrics only. Source preview shows page/region citation metadata in a
reviewable HTML table.

## Boundaries and residuals

The sourced forms are public blank layouts held for local/internal evaluation.
The free small local VLM was installed and smoke-tested, then rejected for
field extraction after a redacted 8-case crop benchmark scored 0/8. Tesseract
5.4.0 is now the measured deterministic OCR baseline at 50/53 manifest labels
with coordinates on every page. The larger official PaddleOCR-VL GGUF was
loaded locally through llama.cpp and recovered 8/8 synthetic values as raw
text, but failed the typed JSON contract at 0/8; it remains an experimental
reader. A managed model remains an explicit future decision. Vector retrieval,
live OpenEMR read/writeback, current deployment identity, external reviewer
access, owner-recorded video, social post, and interviews remain
`INCONCLUSIVE` or `NEEDS_HUMAN` until separately evidenced.
