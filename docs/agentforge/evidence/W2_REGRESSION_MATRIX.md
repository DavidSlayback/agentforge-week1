# W2 regression matrix: review regressions against the rebuilt gate

## Run conditions

- **Command:** `node agentforge/scripts/run-regression-matrix.mjs`.
- **Tree:** branch `refactor/r2`, working tree of the R2 commit (issue #4)
  that retires the legacy LAB|/INTAKE| text path, on a Windows 11 host with
  Node 24.19.0.
- **Method:** each row is one exact, unique text replacement (listed in
  `REGRESSIONS` in the script). The script applies it to a scratch copy of
  `agentforge/`, `observability/`, `evals/` and `docs/agentforge/` in the OS temp
  dir, runs the checks, restores the file, and verifies the restore by SHA-256.
  The real working tree is never edited.
- **Rows:**
  - R2–R16: the review-G2 regressions. **R1 is retired** (see note below).
  - N1–N10: the independent reviewer's regressions for `1c10893`, with their
    edits copied verbatim.
  - I1 and U1: the behaviour added in response to that review.
  - L0: the trace-leak control.

The checks are the pre-commit hook's four checks plus one diagnostic:

| Check | Command | Notes |
| --- | --- | --- |
| **tests** | `npm test --prefix agentforge` | Includes `w2-regression-gate.test.js`, which runs the gate. |
| **unit-only** | agentforge tests with `--test-skip-pattern="^(W2 gate \|evaluator panel exposes)"` | Diagnostic, not a hook check. Excludes the gate's own tests to show what unit tests catch independently. |
| **evals** | `npm test --prefix evals` | |
| **obs** | `node --test observability/test/*.test.js` | |
| **GATE** | `node agentforge/scripts/run-w2-gate.mjs` | Exit 1 = blocked. |

**Result: the gate alone fails for all 27 regression rows and the L0 control
(R2–R16, N1–N10, I1, U1, L0). The no-edit control R0 passes every check.** The
hook blocks every row, because `npm test` includes the gate test.

**R1 retired (R2, issue #4).** R1 ("Empty `quote_or_value` on a text-path lab
citation") targeted `agentforge/src/labEvidence.js`, deleted along with the
legacy LAB|/INTAKE| text path and its old supervisor — the path could not
persist under the deployed OpenEMR module writeback and did not refuse
loudly. The equivalent citation-completeness guard on the surviving
`.scan.txt` path is exercised by N1, N7 and N9 below, and directly by the
gate's `cp-11-scan-text-lab-citations`/`cp-12-scan-text-intake-citations`
cases (added to the golden set when the six legacy-only gate cases were
replaced one-for-one by their `.scan.txt` equivalents; see
[`EVAL_GATE.md`](../../../EVAL_GATE.md)). Re-running the matrix confirms this
did not weaken coverage: see "Rows affected by the `.scan.txt` case
replacement" in the Notes below for exactly which rows gained a
`.scan.txt`-only failing case versus a plain ID swap.

The earlier gate (commit `1c10893`) missed N3, N6, N7, N8 and N9.

| # | Regression | Exact edit (file: find → replace) | tests | unit-only | evals | obs | GATE | Failing gate categories (cases) |
|---|---|---|---|---|---|---|---|---|
| R0 | Control, no edit | — | pass | pass | pass | pass | **pass** | — |
| R2 | Remove the citation from scan-path facts | `scanFormAdapter.js`: `disposition: 'observed', citation, uncertainty` → `disposition: 'observed', uncertainty` | FAIL | FAIL | pass | pass | **FAIL** | all 4 except no_phi_in_logs (35 cases) |
| R3 | Abnormal flag always `normal` | `typedExtraction.js`: `abnormal_flag: abnormalFlagFrom(fields.abnormal.value),` → `abnormal_flag: 'normal',` | FAIL | FAIL | pass | pass | **FAIL** | factually_consistent (fc-01, 02, 03) |
| R4 | Force unit to mg/dL in the typed PDF path | `typedExtraction.js`: `unit: fields.unit.value,` → `unit: 'mg/dL',` | FAIL | FAIL | pass | pass | **FAIL** | factually_consistent (fc-01…04) |
| R5 | Reverse retriever ranking | `guidelineEvidence.js`: `.sort((left, right) => right.score - left.score \|\| …)` → `left.score - right.score` | FAIL | FAIL | pass | pass | **FAIL** | factually_consistent (fc-08, 09, 10) |
| R6 | Retriever returns only the worst chunk | `guidelineEvidence.js`: `.slice(0, Math.max(0, topK));` → `.slice(-1);` | FAIL | FAIL | pass | pass | **FAIL** | factually_consistent (fc-08, 09, 10) |
| R7 | Retriever returns `[]` | `guidelineEvidence.js`: `evidence: ranked.map(…), issues: [] };` → `evidence: [], issues: [] };` | FAIL | FAIL | pass | pass | **FAIL** | citation_present (cp-08), factually_consistent (fc-07…10) |
| R8 | Remove the retriever's score > 0 filter | `guidelineEvidence.js`: delete `.filter((candidate) => candidate.score > 0)` | FAIL | FAIL | pass | pass | **FAIL** | safe_refusal (sr-07, sr-14) |
| R9 | Evidence worker never qualifies/refuses | `activeWorkers.js`: `const qualified = !normalizedQuery \|\| !usable.length \|\| guideline.status !== 'complete';` → `const qualified = false;` | FAIL | FAIL | pass | pass | **FAIL** | safe_refusal (sr-07, sr-14) |
| R10 | Log raw patient name and full OCR text to trace and `console.log` (service.js scan path) | `service.js`: after `if (pdf) workflow.typed_outputs.extraction.provider = prepared.provider;` add `console.log('scan workflow debug', { patient: targetPatient?.name, ocr: prepared.ocrText \|\| contentText });` and `trace?.recordHandoff({ worker: 'debug', name: targetPatient?.name, ocr_dump: prepared.ocrText \|\| contentText });` | FAIL | FAIL | pass | pass | **FAIL** | no_phi_in_logs (np-01, 03…07, 10, 11) |
| R11 | Break the trace redaction regex for quote/value keys | `observability/index.js`: `…\|raw\|value\|field\|quote\|image\|…` → `…\|raw\|field\|image\|…` | FAIL | FAIL | pass | FAIL | **FAIL** | no_phi_in_logs (np-10) |
| R12 | `LabResult` schema stops requiring `reference_range` | `schemas.js`: `  reference_range: z.string().min(1),` → `  reference_range: z.string().min(1).optional(),` | FAIL | FAIL | pass | pass | **FAIL** | schema_valid (sv-07) |
| R13 | Lab extractor drops `reference_range` | `typedExtraction.js`: delete `      reference_range: fields.reference_range.value,` | FAIL | FAIL | pass | pass | **FAIL** | schema_valid (sv-01, 05, 06, 07, 09, 11), factually_consistent (fc-01…04) |
| R14 | Citation schema stops validating `bounding_box` | `schemas.js`: `bounding_box: z.tuple([z.number().nonnegative() ×4]).optional(),` → `bounding_box: z.any().optional(),` | FAIL | FAIL | pass | pass | **FAIL** | schema_valid (sv-09) |
| R15 | Intake extractor drops allergies | `typedExtraction.js`: delete `  allergies: ['allergies'],` from `INTAKE_LEAF_PATHS` | FAIL | FAIL | pass | pass | **FAIL** | schema_valid (sv-03, 04), factually_consistent (fc-05, 06, 07) |
| R16 | OCR label map routes "hemoglobin value" into the unit field | `pdfScanAdapter.js`: `['hemoglobin value', ['lab.hgb.value', 'Hemoglobin value']]` → `['hemoglobin value', ['lab.hgb.unit', 'Hemoglobin value']]` | FAIL | FAIL | pass | pass | **FAIL** | schema_valid (sv-01, 05, 06), factually_consistent (fc-01, 03, 04) |
| N1 | Bounding box off by one (`top + 1`) in the PDF fixture writer | `pdfScanAdapter.js`: `[line?.left, line?.top, line?.right, line?.bottom]` → `[line?.left, line?.top + 1, line?.right, line?.bottom]` | FAIL | pass | pass | pass | **FAIL** | citation_present (cp-01, 03…07) |
| N2 | `collection_date` day/month swapped | `typedExtraction.js`: `collection_date: fields.collection_date.value,` → the same value split on `-`, with parts 1 and 2 swapped | FAIL | pass | pass | pass | **FAIL** | factually_consistent (fc-01…04) |
| N3 | Patient identity ignores DOB | `documentSafety.js`: `else if (formDob !== chartDob) mismatched.push('dob');` → `else if (false) mismatched.push('dob');` | FAIL | FAIL | pass | pass | **FAIL** | safe_refusal (sr-11, sr-13) |
| N4 | Doc-type detector always consistent | `documentSafety.js`: `const typeStatus = typeDetection.detected === 'undetermined' ? … : 'mismatch';` → `const typeStatus = 'consistent';` | FAIL | FAIL | pass | pass | **FAIL** | safe_refusal (sr-03, sr-04) |
| N5 | Evidence-worker query replaced with a constant | `supervisor.js`: `runEvidenceWorker({ query, patientFacts,` → `runEvidenceWorker({ query: 'glycemic follow-up for an elevated A1C', patientFacts,` | FAIL | pass | pass | pass | **FAIL** | factually_consistent (fc-09, 10), safe_refusal (sr-07, sr-14) |
| N6 | `LabResult.confidence` uses max instead of min | `typedExtraction.js`: `confidence: Math.min(...LAB_SUFFIXES` → `confidence: Math.max(...LAB_SUFFIXES` | FAIL | FAIL | pass | pass | **FAIL** | factually_consistent (fc-01…04) |
| N7 | Typed lab citation points at the test-name line, not the value line | `typedExtraction.js`: `citation: fields.value.citation,` → `citation: fields.test_name.citation,` | FAIL | FAIL | pass | pass | **FAIL** | citation_present (cp-01, 05, 06, 11), factually_consistent (fc-01…04) |
| N8 | Missing chart demographics treated as an identity match | `documentSafety.js`: `if (!targetPatient) return { status: 'unverified', mismatched_fields: [] };` → `status: 'match'` | FAIL | FAIL | pass | pass | **FAIL** | safe_refusal (sr-12) |
| N9 | Low-confidence cutoff 0.85 → 0.3 (uncertain facts shown as verified) | `scanFormAdapter.js`: `field.confidence < 0.85 ?` → `field.confidence < 0.3 ?` | FAIL | FAIL | pass | pass | **FAIL** | citation_present (cp-01, 04, 05, 06) |
| N10 | `extraction_incomplete` rule removed | `documentSafety.js`: delete `if (factCount && extraction?.status !== 'complete') qualifying.push('extraction_incomplete');` | FAIL | FAIL | pass | pass | **FAIL** | factually_consistent (fc-04) |
| I1 | Lab reports skip the patient-header identity check | `documentSafety.js`: `: { ...compareIdentity(readHeaderIdentity(documentText), targetPatient), source: 'lab_report_header' };` → `: { status: 'not_applicable', mismatched_fields: [], source: 'lab_report_header' };` | FAIL | FAIL | pass | pass | **FAIL** | safe_refusal (sr-13) |
| U1 | Unreadable PDFs no longer refused (errors propagate as HTTP 500) | `service.js`: body of `isUnreadableDocumentError` → `return false;` | FAIL | FAIL | pass | pass | **FAIL** | safe_refusal (sr-09), no_phi_in_logs (np-09) |
| L0 | Control: the pre-fix trace behaviour (raw handoffs recorded in the scan trace) | `service.js`: `trace?.recordHandoff(traceSafeHandoff(handoff));` → `trace?.recordHandoff(handoff);` | FAIL | FAIL | pass | pass | **FAIL** | no_phi_in_logs (np-01, 06, 07) |

## Notes

- **How the rebuilt gate catches the five N-rows the old gate missed.**

  | Row | Case(s) | Catching check |
  |---|---|---|
  | N3 | sr-11 | A generated intake carries patient 1's name with a different DOB; it must be BLOCKED with `mismatched_fields: ['dob']`. |
  | N3 | sr-13 | Lab-a uploaded to patient 2; its header DOB also differs. |
  | N6 | fc | A lab result's `confidence` must equal the minimum confidence of its six source OCR lines, found by the label printed on the document (`printed_label` in the truth file). |
  | N7 | cp and fc | A typed lab result's citation quote must contain the truth-file value, and every fact's quote must contain the fact's value. |
  | N8 | sr-12 | An intake uploaded to a patient with no chart record must be QUALIFIED `patient_identity_unverified`. |
  | N9 | cp | A fact from an OCR line below 0.85 must carry the review flag, and one at or above 0.85 must not. |

- **Single-case rows.** Six rows are caught by exactly one gate case: R11,
  R12, R14, N8, N10 and I1. (R9 was a single-case row before R2; adding the
  `.scan.txt` off-topic-query case `sr-14` alongside the existing PDF case
  `sr-07` means the evidence-worker regression it guards now trips two
  cases, `sr-07` and `sr-14`.)
  - Every category has 9 to 13 cases, so one failure drops it below 95%, and
    `no_phi_in_logs` has zero tolerance.
  - A unit test enforces at most 19 cases per category, because at 20 cases a
    single failure would be exactly 95% and pass.
- **R11: a second layer, tested explicitly.** The deployed scan trace no longer
  carries value- or quote-keyed data, so the redactor is a second layer. np-10
  records the workflow's real raw handoffs through the real redactor to keep
  that layer tested, and the observability suite has a unit test for it.
- **Unit tests alone.** The unit-only column catches every row except N1, N2
  and N5. Those three are caught only by the gate, which checks against the OCR
  recordings, the truth files and the retrieval ranking.
- **Rows affected by the `.scan.txt` case replacement (R2, issue #4).** R8's
  failing-case list is an ID swap only (`sr-08` → `sr-14`; `sr-08` targeted the
  legacy off-topic-on-text-path case, now retired): still 2 cases, same
  category. Six rows genuinely gain a case, because the code they edit is
  shared between PDF and `.scan.txt` uploads and the legacy cases (`sv-10`,
  `cp-09`, `cp-10`, `np-08`) never exercised that shared code the way their
  scan-path siblings did:
  - R9 and N5 (evidence-worker/query edits): +`sr-14` (1 case → 2).
  - R2 (drop the citation from every scan-path fact): +`sv-11`, `cp-11`,
    `cp-12`, `sr-14` (31 cases → 35).
  - R10 (log raw OCR/patient data on the scan path): +`np-11` (7 cases → 8).
  - R13 (typed lab extractor drops `reference_range`): +`sv-11` (9 cases → 10).
  - N7 (typed lab citation points at the wrong line): +`cp-11` (7 cases → 8).

  This is the concrete evidence the plan asked for: the `.scan.txt`
  replacement cases are exercised by the same production code paths the
  legacy-path cases they replaced were guarding, not a renamed duplicate that
  happens to pass.
- **Evals-check flakiness observed and ruled out as a regression signal.**
  Two full runs of this matrix agreed on every `tests`/`unit-only`/`obs`/
  `GATE` result and every failing-case list, but the `evals` column flipped
  pass/FAIL between runs for R0 (the no-edit control), R10 and N10 — the same
  three rows each time only in the run where it happened, never together with
  a `GATE` or case-list change. Since R0 (literally no edit) reproduced the
  same "FAIL" once and "pass" once, this is pre-existing intermittency in
  spawning the evals test server repeatedly in one process (consistent with
  Windows port/TIME_WAIT reuse across ~29 sequential scratch runs), not a
  behavior this refactor introduced. The table above reports the second,
  fully clean run (`evals` pass on every row).
- **Scratch copy for this run.** The scratch copy for this run was taken before
  `evals/test/service-runner.test.js` switched to the shared `waitForServer`
  helper. That change touches no gate input, and the evals column passes either
  way.

## Leak found and fixed (L0)

Before `1c10893`, `service.js` recorded each raw worker handoff in the scan
trace. Trace redaction is key-name based (`SENSITIVE` in
`observability/index.js`). The typed `lab_results[]` keys `test_name`, `unit`,
`reference_range`, `collection_date` and `abnormal_flag` do not match it, so
collection dates, reference ranges, units, test names and flags reached
`/v1/traces` and the trace file. Lab values (`value`) and quotes were redacted.

The fix is an allowlist, not a longer denylist. `traceSafeHandoff`
(`activeWorkers.js`) keeps only `worker`, `input_type`, `output_status`,
`retry_count`, `step_names`, `citation_count` and `redacted_metrics`. Reverting
it (row L0) fails the gate's `no_phi_in_logs` cases.
