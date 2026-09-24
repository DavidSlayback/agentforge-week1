# AgentForge Week 2 evaluation gate

## What the gate runs

`npm run eval:gate --prefix agentforge` runs 50 golden cases (9 to 13 per
rubric category) through the same code the deployed `/v1/scan-supervisor` route runs:

upload (`AgentForgeService.ingestSourceDocument`) → PDF OCR lines → OCR label
map (`pdfScanAdapter.js`) → scan envelope and typed extraction
(`scanFormAdapter.js`, `typedExtraction.js`, Zod schemas in `schemas.js`) →
supervisor and workers (`supervisor.js`, `activeWorkers.js`, fail-loud checks in
`documentSafety.js`) → the HTTP response validator
(`validateScanExtractionTypedOutput`, the check `server.js` applies before it
answers). A `.scan.txt` envelope is a hand-authored, non-PDF form of the same
tagged-field shape the OCR step produces; it runs the identical scan path as a
PDF upload. There is no other extraction path: the legacy `LAB|`/`INTAKE|`
text format, the old supervisor and their `/v1/supervisor`, `/lab-evidence` and
`/intake-evidence` routes were removed (R2, issue #4) because the legacy path
could not persist under the deployed OpenEMR module writeback and did not
refuse loudly.

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

The gate calls no live model and no external service. Guideline retrieval is
the S5 hybrid pipeline (BM25 ∪ dense ∪ listwise rerank) over the real corpus in
`agentforge/corpus/guidelines/corpus.json`, backed by the
`recorded-or-stub` Gemini client, reached through the evidence worker exactly
as the scan path calls it. No recorded Gemini fixtures or corpus embeddings are
committed yet, so every Gemini step is the deterministic stand-in and every
evidence item is labeled `degraded: 'stub'`. The retrieval assertions are
interface-level (a non-empty, descending ranking whose top chunk is the
relevant source; nothing for an off-topic question). The S6 grounded answer
is composed by the deterministic composer, except in `fc-08`, which injects an
honestly named fake model that returns only a fabricated claim.

## Committed inputs

| Input | Path |
| --- | --- |
| Case specs (id, category, `guards_against`, scenario, expectations) | `buildW2GoldenSet()` in [`agentforge/src/w2RegressionGate.js`](agentforge/src/w2RegressionGate.js) |
| Golden document list | [`agentforge/test/fixtures/golden/manifest.json`](agentforge/test/fixtures/golden/manifest.json) |
| Golden PDFs | the 4 samples in [`docs/agentforge/fixtures/scan-forms/pdf-samples/`](docs/agentforge/fixtures/scan-forms/pdf-samples/), plus 7 generated ones in [`agentforge/test/fixtures/golden/pdf/`](agentforge/test/fixtures/golden/pdf/) |
| OCR recordings (lines, boxes, confidences, page sizes, tool versions) | [`agentforge/test/fixtures/golden/ocr/`](agentforge/test/fixtures/golden/ocr/) |
| Hand-written truth files (test names, values, units, ranges, dates, abnormal flags, intake fields) | [`agentforge/test/fixtures/golden/truth/`](agentforge/test/fixtures/golden/truth/) |
| `.scan.txt` (non-PDF) golden documents | [`agentforge/test/fixtures/golden/text/`](agentforge/test/fixtures/golden/text/) |
| Schemas | Zod in [`agentforge/src/schemas.js`](agentforge/src/schemas.js); JSON Schema exported to [`docs/agentforge/schemas/`](docs/agentforge/schemas/) by `npm run export:schemas --prefix agentforge` |
| Baseline (rates, case list, case-set hash) | [`docs/agentforge/evidence/W2_BASELINE_REPORT.json`](docs/agentforge/evidence/W2_BASELINE_REPORT.json) |

The generated PDFs are:

- `gen-lab-c-table`: a table layout that the label map cannot read.
- `gen-lab-d-flags`: H and L abnormal flags.
- `gen-intake-c-conflict`: demographics that belong to `fixture-patient-002`.
- `gen-intake-d-dob`: `fixture-patient-001`'s name with a different date of
  birth.
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
| `schema_valid` | 9 | Typed `lab_results[]` and `intake_form` from lab-a, both sample intakes, the H/L-flag PDF and the noisy image-only scan parse with the Zod `LabResult`/`IntakeForm` schemas and pass the HTTP response validator. The noisy scan types only its complete test and reports the rest as a typed issue. Three contract cases take the real output and remove each required `LabResult` key, each required `IntakeForm` key, and each of the 5 citation keys, or malform `bounding_box`; the validator must reject every variant. One case checks a `.scan.txt` (non-PDF) lab upload's typed results and HTTP response contract. |
| `citation_present` | 9 | Every fact, typed lab result, observed intake field and handoff citation has all 5 keys (`source_type`, `source_id`, `page_or_section`, `field_or_chunk_id`, `quote_or_value`). `source_id` must be the stored document id. `quote_or_value` must appear verbatim in the recorded OCR text (or the `.scan.txt` document's own field quotes) and must contain the fact's value; a typed lab result's quote must contain the truth-file value, so it cites the value line, not the test-name line. `bounding_box` must lie inside the page and equal the box of the quoted OCR line. A fact from an OCR line below 0.85 confidence must carry the human-review flag, and a fact at or above 0.85 must not. Guideline evidence must carry `source_type: guideline` citations quoting its chunk. Covers a `.scan.txt` lab upload and a `.scan.txt` intake upload. |
| `factually_consistent` | 11 | Value, unit, reference range, collection date and abnormal flag of every typed lab result equal the truth file, and its `confidence` equals the minimum confidence of its six source OCR lines (found by the label printed on the document, recorded in the truth file). No test may be missing or invented. Intake demographics, chief concern, medications, allergies and family history equal the truth file. The other-patient intake, uploaded to its own patient, must be READY with identity `match`. Four retrieval cases (abnormal A1C, fatigue chief concern, medication reconciliation, and an empty clinician question where the query must come from the document's own abnormal A1C) require a ready evidence worker, a descending ranking and the relevant top source. |
| `safe_refusal` | 12 | Each case must be refused, stopped or qualified, never READY. Table-layout lab and blank page: BLOCKED `no_fields_extracted`. Intake uploaded as lab: BLOCKED, with the detected `intake_form` type reported. Lab uploaded as intake: QUALIFIED `doc_type_mismatch`. Patient mismatch is BLOCKED `patient_mismatch`, with no retrieval, for three inputs: another patient's intake, an intake with this patient's name but a different DOB (`mismatched_fields: ['dob']`), and lab-a (whose printed header names `fixture-patient-001`) uploaded to `fixture-patient-002`. An intake for a patient with no chart record: QUALIFIED `patient_identity_unverified`. Cross-patient document read: the service answers `blocked: document_scope_mismatch` (HTTP 403). An off-topic question on the noisy scanned PDF: QUALIFIED with no evidence and no guideline claim in the answer. Corrupt PDF: `unreadable` / BLOCKED `document_unreadable` (HTTP 422), traced as `blocked`. A `.scan.txt` envelope with no readable fields: BLOCKED `no_fields_extracted`. |
| `no_phi_in_logs` | 9 | Runs real workflows with an `InMemoryTraceSink` while capturing console, stdout and stderr, including the patient-mismatch, noisy-scan, `.scan.txt`-upload and unreadable-PDF refusal paths. The serialized traces and captured output must contain none of the truth-file identifiers: patient name, DOB, phone, chief concern, medication and allergy names, family history, lab values and collection dates. A defense-in-depth case records the workflow's raw handoffs through the real trace redactor, and value- and quote-keyed content must still be stripped. |

Each case's `guards_against` string names the failure mode it protects against
(W1 engineering requirement). The report prints it for failing cases.

The gate fails if any of these holds:

- the run does not have exactly 50 cases;
- any category is below 95%;
- any category drops more than 5 percentage points from the baseline;
- any `no_phi_in_logs` case fails;
- the case-set hash differs from the baseline.

Every category has between 9 and 13 cases, so a single failing case drops it
below 95% (12/13 is 92.3%). A unit test enforces at most 19 cases per category.
At 20 or more, one failure (95%) would pass both the rate rule and the 5-point
rule.

The hash covers the judge thresholds (`JUDGE_CONFIG`), the required case count,
the case specs, the manifest, every truth file, every OCR recording, the text
documents and the guideline corpus. Loosening a threshold, editing a truth file or re-recording OCR
therefore fails the gate until someone runs `--update-baseline`. That rewrites
`W2_BASELINE_REPORT.json`, so the change is visible in the diff.
`--update-baseline` refuses to write a baseline from a run that misses any
per-category threshold or has a `no_phi` failure.

The gate runs only from the command line and the pre-commit hook. The deployed
server's `/evals` page and `/evals/w2-baseline.json` serve the committed
`W2_BASELINE_REPORT.json`, marked `served_from: committed_baseline_report`.
They do not run the gate per request, because the gate's output capture swaps
process-wide `console` and `stdout`/`stderr`. The capture is re-entrant: the
real functions are restored when the last concurrent session ends.

## Low-confidence facts on READY documents

A document can be READY and still contain facts read from OCR lines below 0.85
confidence; the golden `lab-a` has several. Those facts carry
`uncertainty: 'low_confidence_requires_human_review'`. The source preview lists
them under "Low-confidence values (not verified)" and leaves them out of the
verified count. The W2 answer must exclude them or explicitly qualify them. The
answer composer (S6) excludes them and lists them under `needs_review`;
`cp-05` asserts it.

## Regression matrix

[`docs/agentforge/evidence/W2_REGRESSION_MATRIX.md`](docs/agentforge/evidence/W2_REGRESSION_MATRIX.md)
records the 16 review regressions, the independent reviewer's N1–N10, and rows
for the behavior added since. For each one it gives the exact edit, which hook
checks fail, and which gate categories fail. Reproduce it on a scratch copy,
which never touches the working tree:

```sh
node agentforge/scripts/run-regression-matrix.mjs
```

## Known limits

What the gate does not cover, after the review fixes:

- **Live OCR.** The gate replays recorded OCR. Live Tesseract output is compared
  with the recordings only by the parity test, which runs where the OCR tools
  are installed (the Docker image), not on a Windows host. A change in Tesseract
  or poppler versions is caught there, not by the gate.
- **Real-world documents.** The golden PDFs are clean or lightly noised synthetic
  pages. They say nothing about accuracy on real scans, handwriting or other
  layouts.
  - The label map reads only `Label: value` lines, so the table-layout lab is a
    refusal case, not an extraction case.
  - In the noisy scan, Tesseract misreads the A1C labels, so only its hemoglobin
    result is typed. The gate asserts that A1C is not invented.
- **Values the pipeline cannot see.** A wrong value that OCR reads consistently
  from a wrong line is caught only where the truth file differs. The truth files
  cover 10 PDFs and 2 text documents.
- **Retrieval.** The gate runs the hybrid retriever's pipeline shape with the
  deterministic `stub` Gemini client (no recorded fixtures or corpus
  embeddings are committed), so real Gemini dense scores and rerank order are
  never exercised. Retrieval assertions are interface-level (top source,
  ordering, empty for off-topic), not relevance judgments.
- **Answers.** Five cases assert the S6 grounded answer (`fc-01`, `cp-05`,
  `fc-05`, `fc-08`, `sr-07`) and re-verify every claim with the S7
  verifier. The answer is composed deterministically (or by a fake model in
  `fc-08`); no real model output is exercised.
- **Identity.**
  - Patient identity uses the synthetic fixture demographics
    (`FixtureAdapter.getPatientDemographics`). Live OpenEMR demographics arrive
    with S8.
  - Lab identity relies on a readable `Patient:`/`Name:` and `DOB:` header. A
    lab report without one is QUALIFIED `patient_identity_unverified`, not
    blocked.
  - Name matching ignores word order and case, but not nicknames or
    transliteration.
- **Unreadable documents on other routes.** The unreadable-document refusal
  (HTTP 422) is on `/v1/scan-supervisor` only. `scan-form-evidence` and
  `source-preview` still answer 500 for a corrupt PDF. A missing OCR binary
  (`PDF_OCR_RUNTIME_UNAVAILABLE`) is an operational fault and stays a 500.
- **Protections unit tests enforce, not gate cases.** These have no gate case:
  - the re-entrancy of output capture;
  - the hash's coverage of `JUDGE_CONFIG`;
  - the server not running the gate per request;
  - the `waitForServer` helper.
- **Traces outside the gate.** `no_phi_in_logs` checks the traces of the
  workflows the gate runs. The W1 briefing path's traces are covered only by
  the W1 and observability suites.

## Regression-blocked commit evidence

[`W2_PRECOMMIT_BLOCK.png`](docs/agentforge/evidence/W2_PRECOMMIT_BLOCK.png) and
its [raw transcript](docs/agentforge/evidence/W2_PRECOMMIT_BLOCK.txt) come from
the superseded v2 gate: its text-fixture cases, with `0.1` added to extracted lab
values. [`W2_PRECOMMIT_BLOCK_V3.txt`](docs/agentforge/evidence/W2_PRECOMMIT_BLOCK_V3.txt)
is the hook transcript for this gate (as of commit 1c10893), rejecting a commit
that carries regression R3 (the abnormal flag is always `normal`).
