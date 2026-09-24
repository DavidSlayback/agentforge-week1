# AgentForge Week 2 evaluation gate

## What the gate runs

`npm run eval:gate --prefix agentforge` runs 50 golden cases (10 per rubric
category) through the same code the deployed `/v1/scan-supervisor` route runs:

upload (`AgentForgeService.ingestSourceDocument`) → PDF OCR lines → OCR label
map (`pdfScanAdapter.js`) → scan envelope and typed extraction
(`scanFormAdapter.js`, `typedExtraction.js`, Zod schemas in `schemas.js`) →
supervisor and workers (`supervisor.js`, `activeWorkers.js`, fail-loud checks in
`documentSafety.js`) → the HTTP response validator
(`validateScanExtractionTypedOutput`, the check `server.js` applies before it
answers). Text-path cases run the `/v1/supervisor` and `/lab-evidence` service
methods on `LAB|`/`INTAKE|` documents.

The one step that is not live is OCR itself. Each golden PDF was OCR'd once with
the real `pdftoppm` + Tesseract stack inside the image built from the repo
`Dockerfile`, and the gate replays those recordings through an injected engine
named `tesseract-recorded-replay` (`createRecordedOcrReplay`). The production
default stays `tesseractOcrEngine` (the real binaries). This keeps the gate
deterministic on machines without Tesseract, such as Windows hosts. The
parity test `agentforge/test/ocr-golden-parity.test.js` re-runs live OCR on
every golden PDF whenever `pdftoppm`, `pdfinfo` and `tesseract` are on PATH, and
it fails if any line's text, box or confidence has drifted from the recording.
It skips, with a message, where the tools are absent.

The gate calls no model and no external service. Guideline retrieval is the
local lexical retriever, reached through the evidence worker exactly as the scan
path calls it. The retrieval assertions are interface-level (a non-empty,
descending ranking whose top chunk is the relevant source; nothing for an
off-topic question) so they survive the S5 retriever replacement.

## Committed inputs

| Input | Path |
| --- | --- |
| Case specs (id, category, `guards_against`, scenario, expectations) | `buildW2GoldenSet()` in [`agentforge/src/w2RegressionGate.js`](agentforge/src/w2RegressionGate.js) |
| Golden document list | [`agentforge/test/fixtures/golden/manifest.json`](agentforge/test/fixtures/golden/manifest.json) |
| Golden PDFs | the 4 samples in [`docs/agentforge/fixtures/scan-forms/pdf-samples/`](docs/agentforge/fixtures/scan-forms/pdf-samples/), plus 6 generated ones in [`agentforge/test/fixtures/golden/pdf/`](agentforge/test/fixtures/golden/pdf/) |
| OCR recordings (lines, boxes, confidences, page sizes, tool versions) | [`agentforge/test/fixtures/golden/ocr/`](agentforge/test/fixtures/golden/ocr/) |
| Hand-written truth files (test names, values, units, ranges, dates, abnormal flags, intake fields) | [`agentforge/test/fixtures/golden/truth/`](agentforge/test/fixtures/golden/truth/) |
| Text-path documents | [`agentforge/test/fixtures/golden/text/`](agentforge/test/fixtures/golden/text/) |
| Schemas | Zod in [`agentforge/src/schemas.js`](agentforge/src/schemas.js); JSON Schema exported to [`docs/agentforge/schemas/`](docs/agentforge/schemas/) by `npm run export:schemas --prefix agentforge` |
| Baseline (rates, case list, case-set hash) | [`docs/agentforge/evidence/W2_BASELINE_REPORT.json`](docs/agentforge/evidence/W2_BASELINE_REPORT.json) |

The generated PDFs are:

- `gen-lab-c-table`: a table layout that the label map cannot read.
- `gen-lab-d-flags`: H and L abnormal flags.
- `gen-intake-c-conflict`: demographics that belong to `fixture-patient-002`.
- `gen-lab-e-scanned`: an image-only page with seeded speckle noise.
- `gen-blank-page`: a blank page.
- `gen-corrupt`: a `%PDF-` header followed by garbage.

They come from
[`agentforge/scripts/generate-golden-pdfs.mjs`](agentforge/scripts/generate-golden-pdfs.mjs),
a hand-written PDF writer that embeds the SIL-OFL Source Sans Pro font already
vendored in this repo; the image has no system fonts. Truth files are written
from each document's source text, never copied from OCR output.

Regenerate and re-record only inside the Docker image. The hash check below then
forces an explicit rebaseline:

```sh
docker build -t agentforge-gate .
docker run --rm -v "$PWD:/repo" -w /repo agentforge-gate node agentforge/scripts/generate-golden-pdfs.mjs
docker run --rm -v "$PWD:/repo" -w /repo agentforge-gate node agentforge/scripts/record-golden-ocr.mjs
```

The golden PDFs, OCR recordings and live OCR were verified with Tesseract 5.5.2
and pdftoppm 25.12.0 in that image.

## Install and run

Requirements: Node.js 24 and the locked dependencies (`zod` is a runtime
dependency). Install them with:

```sh
npm ci --prefix agentforge
```

The enforced gate is the tracked pre-commit hook. It runs `npm ci` if
`agentforge/node_modules` is missing or stale, the agentforge, evals and
observability unit suites, and then this gate. It rejects the commit if any of
them fails. The GitLab project has no CI runner, so [`.gitlab-ci.yml`](.gitlab-ci.yml)
mirrors the hook in the deployed `node:24-alpine` + Tesseract image but does not
execute. Install the hook once per clone:

```sh
git config --local core.hooksPath .githooks
```

Run the gate directly:

```sh
npm run eval:gate --prefix agentforge                         # exit 1 on any failure
npm run eval:gate --prefix agentforge -- --inject-defect      # negative control; must exit 1
npm run eval:gate --prefix agentforge -- --update-baseline    # explicit rebaseline, see below
```

## Rubric and failure conditions

| Category | Cases | What the cases check, and what they guard against |
| --- | --- | --- |
| `schema_valid` | 10 | Typed `lab_results[]` and `intake_form` from four sample PDFs, the H/L-flag PDF and the noisy image-only scan parse with the Zod `LabResult`/`IntakeForm` schemas and pass the HTTP response validator. The noisy scan types only its complete test and reports the rest as a typed issue. Three contract cases take the real output and remove each required `LabResult` key, each required `IntakeForm` key, and each of the 5 citation keys, or malform `bounding_box`; the validator must reject every variant. One case checks the text-path `/lab-evidence` response contract. |
| `citation_present` | 10 | Every fact, typed lab result, observed intake field and handoff citation has all 5 keys (`source_type`, `source_id`, `page_or_section`, `field_or_chunk_id`, `quote_or_value`). `source_id` must be the stored document id. `quote_or_value` must appear verbatim in the recorded OCR text, or in the text document's body for text-path facts. `bounding_box` must lie inside the page and equal the box of the quoted OCR line. Guideline evidence must carry `source_type: guideline` citations quoting its chunk. Covers both text-path documents. |
| `factually_consistent` | 10 | Value, unit, reference range, collection date and abnormal flag of every typed lab result equal the truth file. No test may be missing or invented. Intake demographics, chief concern, medications, allergies and family history equal the truth file. The other-patient intake, uploaded to its own patient, must be READY with identity `match`. Three retrieval cases (abnormal A1C, fatigue chief concern, medication reconciliation) require a ready evidence worker, a descending ranking and the relevant top source. |
| `safe_refusal` | 10 | Each case must be refused, stopped or qualified, never READY. Table-layout lab and blank page: BLOCKED `no_fields_extracted`. Intake uploaded as lab: BLOCKED, with the detected `intake_form` type reported. Lab uploaded as intake: QUALIFIED `doc_type_mismatch`. Other patient's intake: BLOCKED `patient_mismatch`, with no retrieval. Cross-patient document read: the service answers `blocked: document_scope_mismatch`, which the handler maps to 403. Off-topic questions on the scan path and on the `/v1/supervisor` path: QUALIFIED with no evidence. Corrupt PDF: the request fails and is traced as a failure. `LAB|` document declared as intake: BLOCKED `no_fields_extracted`. |
| `no_phi_in_logs` | 10 | Runs real workflows with an `InMemoryTraceSink` while capturing console, stdout and stderr, including the patient-mismatch, noisy-scan, text-path and corrupt-PDF failure paths. The serialized traces and captured output must contain none of the truth-file identifiers: patient name, DOB, phone, chief concern, medication and allergy names, family history, lab values and collection dates. A defense-in-depth case records the workflow's raw handoffs through the real trace redactor, and value- and quote-keyed content must still be stripped. |

Each case's `guards_against` string names the failure mode it protects against
(W1 engineering requirement). The report prints it for failing cases.

The gate fails if any of these holds:

- the run does not have exactly 50 cases;
- any category is below 95% (with 10 cases, one failure is 90%);
- any category drops more than 5 percentage points from the baseline;
- any `no_phi_in_logs` case fails;
- the case-set hash differs from the baseline.

The hash covers the case specs, the manifest, every truth file, every OCR
recording and the text documents. Editing a truth file or re-recording OCR
therefore fails the gate until someone runs `--update-baseline`, and that
rewrites `W2_BASELINE_REPORT.json`, so the change is visible in the diff.
`--update-baseline` refuses to write a baseline from a run that misses any
per-category threshold or has a `no_phi` failure.

## Regression matrix

[`docs/agentforge/evidence/W2_REGRESSION_MATRIX.md`](docs/agentforge/evidence/W2_REGRESSION_MATRIX.md)
records the 16 review regressions. For each one it gives the exact edit, which
hook checks fail, and which gate categories fail. Reproduce it on a scratch
copy, which never touches the working tree:

```sh
node agentforge/scripts/run-regression-matrix.mjs
```

## Known limits

- The gate replays recorded OCR. Live OCR is covered only by the parity test,
  which runs where the OCR tools are installed (the Docker image), not on a
  Windows host.
- The golden PDFs are clean or lightly noised synthetic pages. They say nothing
  about accuracy on real scans, handwriting or arbitrary layouts. The label map
  reads only `Label: value` lines, which is why the table-layout lab is a refusal
  case and not an extraction case. In the noisy scan, Tesseract misreads the A1C
  labels (`AlCvalue`, `Al1C abnormal`), so only its hemoglobin result is typed,
  and the gate asserts that A1C is not invented.
- The corrupt-PDF case asserts that the service rejects the request. Over HTTP
  that is currently a 500 `internal_error`, not a structured refusal.
- The gate uses the local lexical retriever and never calls Cohere, Gemini or a
  model.

## Regression-blocked commit evidence

[`W2_PRECOMMIT_BLOCK.png`](docs/agentforge/evidence/W2_PRECOMMIT_BLOCK.png) and
its [raw transcript](docs/agentforge/evidence/W2_PRECOMMIT_BLOCK.txt) come from
the superseded v2 gate: its text-fixture cases, with `0.1` added to extracted lab
values. [`W2_PRECOMMIT_BLOCK_V3.txt`](docs/agentforge/evidence/W2_PRECOMMIT_BLOCK_V3.txt)
is the hook transcript for this gate, rejecting a commit that carries regression
R3 (the abnormal flag is always `normal`).
