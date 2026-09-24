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

The W1 deterministic briefing path (`PreVisitPreparation`/`verifyClaims`)
remains the safety baseline for the clinical co-pilot. The legacy LAB|/INTAKE|
text-path supervisor this section used to describe alongside it was retired in
R2 (issue #4): it could not persist under the deployed OpenEMR module
writeback and did not refuse loudly. The active path is a bounded
multi-worker document/evidence seam and does not write clinical actions. The
local VLM adapter is opt-in, typed, crop-bounded, and fail-closed when no local
model runner is configured or measured. The eventual API/managed provider can
replace this runner without changing the worker contract. The separate
`write-clinical-action` lane still
requires explicit clinician confirmation and remains synthetic-only.

## OpenEMR persistence (S8)

With `AGENTFORGE_PERSISTENCE_MODE=openemr-module` (set for `agentforge-w2` in
Compose) the service calls `oe-module-agentforge/public/api.php` on the internal
network. Requests are HMAC-signed with `AGENTFORGE_MODULE_HMAC_SECRET`, which
only `openemr` and `agentforge-w2` hold, and carry a context token signed with
`AGENTFORGE_DEMO_SECRET`. On upload the source is stored as an OpenEMR document
("Lab Report" or "Medical Record"). After a validated extraction, and only when
the caller's own context is write-scoped (`write-source-document`), the service
stores a derived-facts JSON document linked to the source and, for a lab PDF,
one `procedure_order`/`_report` plus one `procedure_result` per LOINC-mapped
result (`718-7` hemoglobin, `4548-4` A1c; others are reported as unmapped). A
read-scoped caller gets `openemr.status: not_persisted`, `reason:
persistence_not_authorized`. The service then reads the results back as FHIR
Observations and fails the request (502) unless every value matches. A write
ledger keyed by patient and content hash makes re-uploads return the same ids
with `duplicate: true` and zero new rows; a different payload on an existing key
is reported as `derived_payload_differs` / `lab_payload_differs` and not
written. Every write is limited to the allowlisted synthetic patients, whatever
the token issuer, and recorded with its issuer. Clinician-confirmed intake
medications and allergies have a module route, but the service's
clinical-action lane does not call it yet.

**Lab values are preliminary.** The rows are unreviewed AI extraction, so
`procedure_report.report_status` and `procedure_result.result_status` are
`prelim` (OpenEMR's own option) and `review_status` is `received`, pending
clinician review. OpenEMR 8.0.0's FHIR mapper does not translate `prelim`, so the
Observations report `status: "unknown"`, never `final`.

Known gaps:
- The lab read-back uses OpenEMR's FHIR Observation service **in-process**
  (`read_path: openemr-fhir-service-in-process`), not the `/fhir` HTTP API,
  which is disabled on the deployment (`rest_fhir_api=0`) and would need an
  interactive OAuth grant with `api:fhir user/Observation.rs`.
- Orphan file on rollback: `Document::createDocument` writes the encrypted file
  before the ledger transaction commits. If the transaction rolls back, the
  database rows are rolled back but the file stays under
  `sites/default/documents/<pid>/`, referenced by no `documents` row and never
  served; the request fails with `write_failed` (see `Write/DocumentWriter.php`).
- The Week 1 launcher (`public/index.php`) is unchanged and still has the F18
  ACL bug (it checks the numeric user id instead of the username); W1 is frozen.
- The live round-trip is unverified until `agentforge/scripts/w2-openemr-smoke.mjs`
  passes on the deployed SHA.

## Evidence and retrieval

Observed fields carry a `w2-scan-v1` citation with source document, page, field,
quote, layout, and bounding box. Missing, unreadable, and conflicting values are
represented as qualification metadata and are not promoted to facts;
low-confidence values stay facts but carry an `uncertainty` marker and are
listed for review. Guideline evidence is returned separately from patient
facts. The local retrieval choice is the existing deterministic sparse plus
dense-proxy index because the fixed synthetic benchmark is replayable, cited,
and zero-cost; `dense_score` is not a true embedding score.

For PDF citations, `page_sizes` records each page's raster width and height at
200 DPI, matching the pixel coordinate space produced by Tesseract. The preview
loads each page through the patient-scoped `/v1/source-documents/:id/pages/:n.png`
route and positions each citation box as percentages of those dimensions; a
citation link targets the matching box in the page overlay. Text-only `.scan.txt`
fixtures have no rendered page image and keep their coordinate values as text.

## Evaluation and observability

The 50-case gate runs the deployed scan path on 10 golden PDFs, replaying OCR
recorded from the real Tesseract image, and asserts `schema_valid`,
`citation_present`, `factually_consistent`, `safe_refusal`, and
`no_phi_in_logs` (10 cases each) against hand-written truth files; see the root
`EVAL_GATE.md`. The fail-loud rules live in `documentSafety.js`:

- BLOCKED: zero extracted fields, or patient demographics that contradict the
  chart. For intake forms that means the typed name or DOB; for lab reports, the
  printed `Patient:`/`DOB:` header.
- QUALIFIED:
  - a declared type contradicted by the document's text;
  - an identity that cannot be verified (nothing readable, or no chart record);
  - an incomplete extraction.
- An unreadable PDF on `/v1/scan-supervisor` is a BLOCKED
  `document_unreadable` refusal (HTTP 422).

Traces record allowlisted handoff summaries (`traceSafeHandoff`), not
extraction payloads. The server serves the committed gate report on `/evals`
and does not run the gate per request.

Facts read from OCR lines below 0.85 confidence carry
`low_confidence_requires_human_review`. They do not by themselves stop a
document from being READY. The source preview lists them in a separate "not
verified" section, and the W2 answer must exclude them or explicitly qualify
them. The S6 answer composer will enforce that; nothing enforces it yet.

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
