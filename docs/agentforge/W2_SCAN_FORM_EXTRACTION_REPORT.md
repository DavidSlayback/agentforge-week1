# Week 2 scan-form extraction repor

Date: 2026-09-22
Contract: `w2-scan-v1`
Providers: the tagged-envelope parser (labeled `uploaded-tagged-envelope` since the W3 hardening; it was `synthetic-ocr-vlm-adapter`, although no OCR or VLM runs on that path) plus an opt-in `local-vlm-adapter` seam
Disposition: deterministic contract evidence plus a sourced public blank-form corpus; local OCR is measured and a larger local VLM is benchmarked but not promoted.

## External form corpus

The prior fixture-only input gap is now closed for local source-material
coverage. Four actual blank public forms are checked into
`docs/agentforge/external-forms/`: two state public-health laboratory forms and
two NHS intake questionnaires. Their URLs, hashes, page counts, blank checks,
and human-reviewed label boxes are recorded in
`docs/agentforge/fixtures/w2-external-form-manifest.json` and described in
`docs/agentforge/EXTERNAL_FORM_CORPUS.md`.

The corpus now supports local model-quality evidence. No external OCR/VLM call
was made. The new local adapter accepts only `public_blank` inputs with
`local_only` processing, normalizes model candidates into the same typed
citation contract, and fails closed when no local runner is configured. A
human approval is still required before transmitting any document to an
external provider.

## Matrix

| Fixture | Type/layout | Variant | Expected result | Observed result |
|---|---|---|---|---|
| `lab-layout-a-complete` | lab / A | complete | 2 cited fields | 2 cited fields |
| `lab-layout-b-partial` | lab / B | partial | Hgb plus missing A1C | Hgb plus explicit missing A1C |
| `lab-layout-b-unreadable` | lab / B | unreadable | no facts, human review | qualified, two unreadable fields |
| `intake-layout-a-complete` | intake / A | complete | 3 cited fields | 3 cited fields |
| `intake-layout-b-conflict` | intake / B | conflicting | withhold conflicting medication | qualified, conflict retained |
| `intake-layout-b-missing` | intake / B | missing | concern plus two missing fields | partial, missing fields retained |

## Filled-PDF fixture benchmark — 2026-09-23

The separate assignment PDF path recognizes the complete minimum field sets:

- Lab result: two named tests with value, unit, reference range, collection
  date, abnormal flag, and one page-region citation per field (12 facts).
- Intake form: patient name, date of birth, phone, chief concern, medications,
  allergies, and family history (7 facts).

Four fixed synthetic PDFs cover both types. Layout A is vector PDF text; Layout
B is a rasterized page image with alternate common labels. The reproducible
runner is `npm run eval:pdf-samples` inside the service container. Current
result: 38/38 exact expected values, all 38 fields contract-valid and cited,
4/4 documents complete. PDF boxes are measured in 200 DPI raster pixels.
This is exact recovery on clean generated fixtures;
it does not measure physical scans, handwriting, or general layouts. The
fixtures and expected values are in
`docs/agentforge/fixtures/scan-forms/pdf-samples/`.

## Evidence

- The manifest and ground truth are in
  `docs/agentforge/fixtures/w2-scan-form-manifest.json`.
- Rendered synthetic previews are SVG images in the adjacent `scan-forms`
  directory. Their page-region boxes are repeated in the fixture rows and in
  returned citations.
- `agentforge/src/scanFormContracts.js` rejects wrong versions, document types,
  invalid boxes, missing confidence, uncited observed values, and unapproved
  non-local data classes.
- `agentforge/src/scanFormAdapter.js` quarantines malformed rows, emits no fac
  for missing/unreadable/conflicting fields, and marks review reasons.
- `agentforge/src/localVlmAdapter.js` is the local VLM boundary: it requires an
  injected local runner, records model identity, validates page/region output,
  and never turns an absent runner into synthetic VLM evidence.
- Tesseract 5.4.0 is installed at `C:\\Program Files\\Tesseract-OCR\\tesseract.exe`.
  On the four public blank forms it recognized 50/53 manifest labels (94.3%),
  but only 32/53 labels (60.4%) overlapped their expected manifest regions a
  the benchmark's 0.5 threshold. Per-form region rates were Hawaii 4/10,
  Maine 11/13, Broom Road 6/14, and Erskine 11/16. It emitted word
  coordinates on every page. Label recall is not field localization. Evidence
  is in `evidence/W2_TESSERACT_BASELINE.json`.
- `agentforge/test/scan-form.test.js` covers complete, partial, unreadable,
  conflicting, citation validation, worker handoffs, supervisor qualification,
  and deterministic retrieval choice.

## Boundary

The deterministic path is verified locally. The local VLM contract is verified
with a fake runner, and a small quantized local SmolVLM runtime has now passed
an image-ingress smoke test against a sourced Hawaii form page through Docker
Model Runner. That smoke test is not a field/citation benchmark; scanned-PDF
field accuracy, crop-level abstention, latency, and production suitability
were measured in `evidence/W2_LOCAL_VLM_BENCHMARK.json`: 8/8 requests
completed, 0/8 synthetic values matched, 8/8 failed to extract the requested
value, and CPU latency was 2.41–2.70 seconds per crop. The small model is
rejected for promotion as a field extractor. The larger official PaddleOCR-VL
GGUF was loaded locally through llama.cpp. It recovered 8/8 synthetic values
as unconstrained raw text, but the required structured JSON contract scored
0/8; JSON-constrained mode also scored 0/8. Evidence is in
`evidence/W2_LOCAL_PADDLEOCR_VL_RAW_BENCHMARK.json` and
`evidence/W2_LOCAL_PADDLEOCR_VL_BENCHMARK.json`. It remains an experimental
visual reader, not the promoted field extractor; deterministic extraction
remains the active baseline. A second free document-focused candidate was
removed after runner incompatibility/unusable GGUF output; its redacted
failure report is in `evidence/W2_LOCAL_SMOLDOCLING_BENCHMARK.json`.

The typed-bridge benchmark was rerun on the larger PaddleOCR-VL model with a
strict label/value/confidence/abstention JSON contract. It covered eigh
synthetic-overlay cases across all four sourced forms and both pages of each
multi-page intake form. Results: 0/8 typed value matches, 8/8 explici
abstentions for invalid JSON, 5/8 raw-text matches (not counted as extraction
success), and Tesseract located 4/8 selected labels in the expected regions.
Local request latency was 2.05–20.96 seconds per crop. The image regions are
manifest-selected, so this is a bounded crop/contract benchmark, not automatic
whole-document field discovery. Redacted results and hashes only are in
`evidence/W2_LOCAL_PADDLEOCR_VL_TYPED_BENCHMARK.json`; raw responses/images
were not retained in that artifact. Disposition: VLM gate `INCONCLUSIVE`, no
promoted; Tesseract remains the deterministic baseline, with region-mapping
quality itself a follow-up gap.
