# W2 regression matrix: the 16 review-G2 regressions against the rebuilt gate

## Run conditions

- **Command:** `node agentforge/scripts/run-regression-matrix.mjs`.
- **Tree:** branch `agentforge/s1-gate`, working tree of the commit that adds
  this file. The last run was on the final tree, on a Windows 11 host with
  Node 24.19.0.
- **Method:** each row is one exact, unique text replacement (listed in
  `REGRESSIONS` in the script). The script applies it to a scratch copy of
  `agentforge/`, `observability/`, `evals/` and `docs/agentforge/` in the OS temp
  dir, runs the checks, restores the file, and verifies the restore by SHA-256.
  The real working tree is never edited.

The checks are the pre-commit hook's four checks plus one diagnostic:

| Check | Command | Notes |
| --- | --- | --- |
| **tests** | `npm test --prefix agentforge` | Includes `w2-regression-gate.test.js`, which runs the gate. |
| **unit-only** | agentforge tests with `--test-skip-pattern="^(W2 gate \|evaluator panel exposes)"` | Diagnostic, not a hook check. Excludes the gate tests and the `/evals` page test, which also runs the gate, so this column shows what unit tests catch on their own. |
| **evals** | `npm test --prefix evals` | |
| **obs** | `node --test observability/test/*.test.js` | |
| **GATE** | `node agentforge/scripts/run-w2-gate.mjs` | Exit 1 = blocked. |

**Result: the gate alone fails for 16 of 16.** The no-edit control (R0) passes
every check. The hook blocks every row, because `npm test` includes the gate
test.

| # | Regression | Exact edit (file: find → replace) | tests | unit-only | evals | obs | GATE | Failing gate categories (cases) |
|---|---|---|---|---|---|---|---|---|
| R0 | Control, no edit | — | pass | pass | pass | pass | **pass** | — |
| R1 | Empty `quote_or_value` on a text-path lab citation | `labEvidence.js`: `quote_or_value: values.quote, bounding_box: boundingBox }` → `quote_or_value: '', bounding_box: boundingBox }` | FAIL | FAIL | pass | pass | **FAIL** | schema_valid (sv-10), citation_present (cp-09) |
| R2 | Remove the citation from scan-path facts | `scanFormAdapter.js`: `disposition: 'observed', citation, uncertainty` → `disposition: 'observed', uncertainty` | FAIL | FAIL | pass | pass | **FAIL** | schema_valid (sv-01…09), citation_present (cp-01…08), factually_consistent (all 10), safe_refusal (sr-04, sr-05, sr-07) |
| R3 | Abnormal flag always `normal` | `typedExtraction.js`: `abnormal_flag: abnormalFlagFrom(fields.abnormal.value),` → `abnormal_flag: 'normal',` | FAIL | FAIL | pass | pass | **FAIL** | factually_consistent (fc-01, fc-02, fc-03) |
| R4 | Force unit to mg/dL in the typed PDF path | `typedExtraction.js`: `unit: fields.unit.value,` → `unit: 'mg/dL',` | FAIL | FAIL | pass | pass | **FAIL** | factually_consistent (fc-01…04) |
| R5 | Reverse retriever ranking | `guidelineEvidence.js`: `.sort((left, right) => right.score - left.score \|\| …)` → `.sort((left, right) => left.score - right.score \|\| …)` | FAIL | FAIL | pass | pass | **FAIL** | factually_consistent (fc-08, fc-09, fc-10) |
| R6 | Retriever returns only the worst chunk | `guidelineEvidence.js`: `.slice(0, Math.max(0, topK));` → `.slice(-1);` | FAIL | FAIL | pass | pass | **FAIL** | factually_consistent (fc-08, fc-09, fc-10) |
| R7 | Retriever returns `[]` | `guidelineEvidence.js`: `evidence: ranked.map(…guidelineEvidenceItem…), issues: [] };` → `evidence: [], issues: [] };` | FAIL | FAIL | pass | pass | **FAIL** | citation_present (cp-08), factually_consistent (fc-07…10) |
| R8 | Remove the retriever's score > 0 filter | `guidelineEvidence.js`: delete the line `.filter((candidate) => candidate.score > 0)` | FAIL | FAIL | pass | pass | **FAIL** | safe_refusal (sr-07, sr-08) |
| R9 | Evidence worker never qualifies/refuses | `activeWorkers.js`: `const qualified = !normalizedQuery \|\| !usable.length \|\| guideline.status !== 'complete';` → `const qualified = false;` | FAIL | FAIL | pass | pass | **FAIL** | safe_refusal (sr-07) |
| R10 | Log raw patient name and full OCR text to the trace and `console.log` (service.js scan path) | `service.js`: after `if (pdf) workflow.typed_outputs.extraction.provider = prepared.provider;`, add `console.log('scan workflow debug', { patient: targetPatient?.name, ocr: prepared.ocrText \|\| contentText });` and `trace?.recordHandoff({ worker: 'debug', name: targetPatient?.name, ocr_dump: prepared.ocrText \|\| contentText });` | FAIL | FAIL | pass | pass | **FAIL** | no_phi_in_logs (np-01…07, np-10) |
| R11 | Break the trace redaction regex for quote/value keys | `observability/index.js`: `…\|raw\|value\|field\|quote\|image\|…` → `…\|raw\|field\|image\|…` | FAIL | FAIL | pass | FAIL | **FAIL** | no_phi_in_logs (np-10) |
| R12 | `LabResult` schema stops requiring `reference_range` | `schemas.js`: `  reference_range: z.string().min(1),` → `  reference_range: z.string().min(1).optional(),` | FAIL | FAIL | pass | pass | **FAIL** | schema_valid (sv-07) |
| R13 | Lab extractor drops `reference_range` | `typedExtraction.js`: delete `      reference_range: fields.reference_range.value,` | FAIL | FAIL | pass | pass | **FAIL** | schema_valid (sv-01, 02, 05, 06, 07, 09), factually_consistent (fc-01…04) |
| R14 | Citation schema stops validating `bounding_box` | `schemas.js`: `bounding_box: z.tuple([z.number().nonnegative() ×4]).optional(),` → `bounding_box: z.any().optional(),` | FAIL | FAIL | pass | pass | **FAIL** | schema_valid (sv-09) |
| R15 | Intake extractor drops allergies | `typedExtraction.js`: delete `  allergies: ['allergies'],` from `INTAKE_LEAF_PATHS` | FAIL | FAIL | pass | pass | **FAIL** | schema_valid (sv-03, sv-04), factually_consistent (fc-05, 06, 07) |
| R16 | OCR label map routes "hemoglobin value" into the unit field | `pdfScanAdapter.js`: `['hemoglobin value', ['lab.hgb.value', 'Hemoglobin value']]` → `['hemoglobin value', ['lab.hgb.unit', 'Hemoglobin value']]` | FAIL | FAIL | pass | pass | **FAIL** | schema_valid (sv-01, 05, 06), factually_consistent (fc-01, 03, 04) |
| L0 | Control: the pre-fix trace behaviour (raw handoffs recorded in the scan trace) | `service.js`: `trace?.recordHandoff(traceSafeHandoff(handoff));` → `trace?.recordHandoff(handoff);` | FAIL | FAIL | pass | pass | **FAIL** | no_phi_in_logs (np-01, 02, 06, 07) |

## Notes

- **R2, R13, R15, R16 fail across several categories.** These edits are
  upstream of several assertions, so one edit breaks citations, typed values and
  refusal states together.
- **R9 is caught by one case (sr-07).** R9 only matters when the evidence worker
  would otherwise qualify, and sr-08 goes through `/v1/supervisor`, which does
  not use `runEvidenceWorker`.
- **R12 and R14 are caught by one contract-mutation case each (sv-07, sv-09).**
  Loosening a schema does not change what the extractor emits for well-formed
  documents. The gate catches it by feeding real outputs with a required key
  removed, or with a malformed `bounding_box`, to the HTTP response validator.
- **R11 is caught by one case (np-10).** After the leak fix below, the deployed
  scan trace no longer carries value- or quote-keyed data, so the redactor is a
  second layer. np-10 records the workflow's real raw handoffs through the real
  redactor to keep that layer tested. The observability suite now also has a
  unit test for it.
- **Why one failing case is enough today.** With 10 cases per category, one
  failure drops the category to 90%, below the 95% threshold, and
  `no_phi_in_logs` has zero tolerance. If a category ever grows past 19 cases,
  a single failure would pass both the 95% rate and the 5-point regression
  rules, so single-case detections such as R9, R12, R14 and R11 would need more
  cases or a stricter rule.
- **Unit tests catch all 16 independently of the gate** (the unit-only column).
  R4 is caught only because `test/pdf-scan.test.js` gained a unit assertion in
  this change; before that, only the gate caught R4.

## Leak found and fixed (L0)

Before this change, `service.js` recorded each raw worker handoff in the scan
trace. Trace redaction is key-name based (`SENSITIVE` in
`observability/index.js`). The typed `lab_results[]` keys `test_name`, `unit`,
`reference_range`, `collection_date` and `abnormal_flag` do not match it, so
collection dates, reference ranges, units, test names and flags reached
`/v1/traces` and the trace file. A scripted scan workflow before the fix showed
`2026-09-20` and `12.0-16.0` in the serialized trace. Lab values themselves
(`value`) and quotes were redacted.

The fix is an allowlist, not a longer denylist. `traceSafeHandoff`
(`activeWorkers.js`) keeps only `worker`, `input_type`, `output_status`,
`retry_count`, `step_names`, `citation_count` and `redacted_metrics`. The L0 row
shows that reverting the fix fails the gate's `no_phi_in_logs` cases.
