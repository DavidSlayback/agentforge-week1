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
every golden PDF and fails if any line's text, box or confidence has drifted
from the recording. It and the two other live-OCR tests (listed in
`agentforge/test/helpers/ocrTools.js`) never skip silently:

- In the unit run on a host without the tools they skip and print a `SKIP`
  line naming the test and the missing tools.
- The pre-commit hook then runs them with `AGENTFORGE_REQUIRE_OCR=1` through
  `agentforge/scripts/run-ocr-tests.sh`: natively when the tools are on PATH,
  otherwise in Docker, in an image built from the repo `Dockerfile`'s own
  `FROM` and `RUN apk add ... tesseract` lines (tagged by their hash, so later
  runs reuse it). With neither tools nor Docker, the hook blocks a commit that
  touches the OCR path or OCR fixtures, and prints a loud SKIP banner otherwise.
- `.gitlab-ci.yml` installs the tools and sets `AGENTFORGE_REQUIRE_OCR=1`, so a
  missing tool fails there.

Running them for the first time (H5, 2026-10-01) found that live OCR had not
matched the recordings since S6 (2026-09-24). S6 passed `--psm 6` to
Tesseract and called it Tesseract's default; the default is `--psm 3`, which
the 50-case recordings were made with. At psm 6 the deployed path read
`gen-lab-d-flags`' "A1C abnormal: H" as "Al1C" and joined the table lab's name
and date into one line, and 8 golden cases failed against live OCR. The default
is back to psm 3 (`DEFAULT_OCR_MODE = 'psm3'`). The 10 original recordings are
byte-identical at psm 3; the 3 extension recordings (`medlist-a`, `medlist-b`,
`lab-c`) were re-recorded at psm 3, and the extension suite passes 54/54 (56/56 with the H5 cases).

The gate calls no live model and no external service. Guideline retrieval is
the S5 hybrid pipeline (BM25 ∪ dense ∪ listwise rerank) over the real corpus in
`agentforge/corpus/guidelines/corpus.json`, backed by the
recorded-or-stub embed client and reranker, reached through the evidence worker
exactly as the scan path calls it. Real `gemini-embedding-2` corpus vectors
(`corpus/embeddings.json`) and real recorded query-embed and `qwen3.8-flash`
rerank responses (`test/fixtures/retrieval/`) are committed. The gate uses them
only when `COMPLETE.json`'s embeddings fingerprint and rerank provider/model
match its own configuration; on a mismatch it falls back to the deterministic
stand-in, and the evidence says so (`degraded: 'stub'`). The retrieval
assertions check a non-empty, descending ranking whose top chunk is the
relevant source (or, for the A1C interpretation questions, one of a small set
of equally relevant sources), and nothing for an off-topic question. The S6 grounded answer
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
observability unit suites, the live-OCR tests (see above), and then this gate.
It rejects the commit if any of them fails.

The hook and `.githooks/pre-push` test the working tree, so both first refuse
when it differs from what is committed or pushed
(`.githooks/lib/gated-tree.sh`). Pre-commit refuses unstaged or untracked files
under the gated paths (`agentforge`, `evals`, `observability`, `dashboard`,
`deploy/vultr`, the PHP module, `docs/agentforge/{fixtures,evidence,schemas}`,
`Dockerfile`, `.githooks`, `.gitlab-ci.yml`). Pre-push refuses any difference
from `HEAD`, and a push of a ref other than `HEAD`. Stage, discard or ignore the
files, then retry. Do not stash: the stash stack is shared by every worktree.
Copying the index into a temp tree was rejected because it needs a second
`npm ci` for agentforge and the dashboard on every commit. The GitLab project has no CI runner, so [`.gitlab-ci.yml`](.gitlab-ci.yml)
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
| `no_phi_in_logs` | 9 | Runs real workflows while capturing console, stdout and stderr, including the patient-mismatch, noisy-scan, `.scan.txt`-upload and unreadable-PDF refusal paths. Three things are scanned: the run's trace as the deployed `FileTraceSink` persists it to disk, the run's own raw workflow handoffs recorded through the same redacting sink, and the captured output. None may contain the truth-file identifiers (patient name, DOB, phone, chief concern, medication and allergy names, family history, lab values, collection dates, reference ranges) or the values this run extracted. No typed lab field (`test_name`, `value`, `unit`, `reference_range`, `collection_date`, `abnormal_flag`) may appear as a serialized key/value pair. The service records only metrics in its trace, so a redactor regression shows in the raw-handoff replay, which every case with a workflow runs (`np-10` requires it). |

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
the case specs (function-valued fields, such as a fake provider, by their
source), the judge's own source (`w2RegressionGate.js` with every check
function, and `gateClaimJudge.js`), the manifest, every truth file, every OCR
recording, the text documents and the guideline corpus. Loosening a threshold
or a check, editing a truth file or re-recording OCR therefore fails the gate
until someone runs `--update-baseline`. That rewrites `W2_BASELINE_REPORT.json`,
so the change is visible in the diff. `--update-baseline` refuses to write a
baseline from a run that misses any per-category threshold or has a `no_phi`
failure.

The baseline records the commit it was generated at (`generated_at.git_sha`,
and `dirty` when tracked files other than the two baseline reports had
uncommitted changes). Each gate run prints that
SHA next to its own on stderr and reports both (`git_sha`,
`baseline_generated_at`). A different SHA is expected after code changes and
never fails the gate; the hash is what pins the judge and its inputs.

## Independent claim judge

Every case with `expect.answer` runs `judgeAnswerClaims`
(`agentforge/src/gateClaimJudge.js`) on the shipped answer. It imports nothing,
so a defect in the production verifier (`claimBinding.js`) cannot also hide
from it; `test/gate-claim-judge.test.js` fails if it ever imports anything.

- Each claim must have a citation.
- Each citation must name a source this run produced (same `source_type`,
  `source_id`, `field_or_chunk_id` and `quote_or_value`), of the claim's kind.
- Every number in the claim text must appear in what it cites: the quote or a
  typed field of the cited item, such as a range, collection date or guideline
  version date.

The gate still re-runs `verifyClaims` against its own allowed-value set, now
reported as `answer_claim_fails_production_verifier_recheck`; that check is not
independent. `fc-08`'s fake model also returns a claim with no citation, which
must be dropped and counted. The extension cases `xh5-judge-uncited-model-claim`
and `xh5-judge-number-not-in-cited-source` plant an uncited claim and a claim
with a number its source does not hold on the model path, where a model answer
actually ships. `cp-05`'s low-confidence check is structural: no patient-fact
claim may cite a lab result or intake field below 0.85, and each one must be in
`needs_review` by field id.

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

## Extension suite (PRD p. 5–6 extension items)

The PRD's deliverables list also names a critic agent, click-to-source, a
third document type, a lab trend chart and contextual retrieval (`PLAN.md`,
D12). Their cases live in a separate **extension suite**, so the golden set
stays at exactly the 50 cases the PRD asks for, while the new behaviour
still blocks commits.

- Run it with `npm run eval:extensions --prefix agentforge`. The pre-commit
  hook runs it right after the 50-case gate, and `.gitlab-ci.yml` mirrors it.
- It uses the same judge (`JUDGE_CONFIG`), the same five labels, the same
  95% per-label threshold, the same 5-point regression rule, and a committed
  baseline (`docs/agentforge/evidence/W2_EXTENSION_BASELINE_REPORT.json`).
- There are two differences. The case count is whatever the suite holds,
  but an empty suite fails. A label with no extension cases is skipped rather
  than failed. A missing baseline also fails.
- Each slice owns one file in `agentforge/src/extensionCases/` and adds it
  to `index.js`. A case can carry its own check (`expect.custom`) and inject
  service collaborators (`scenario.service_overrides`), so a slice never
  edits the golden dispatcher.
- The suite has 56 cases (`W2_EXTENSION_BASELINE_REPORT.json`): the 54 in
  that baseline at `9b25806c` plus the 2 H5 claim-judge cases (`xh5-*`,
  `extensionCases/claimJudge.js`). They are listed below by slice.
- The critic is disabled in all 50 golden cases (`critic_disabled`), so a
  critic that never vetoes passes the 50-case gate. The `x2-*` cases catch it,
  and the extension suite blocks in the same places as the golden gate: the
  pre-commit hook, `.githooks/pre-push` and the `w2-regression-gate` CI job.
- Click-to-source (E1): `x1-click-to-source-lab-a` and `x1-click-to-source-intake-b`.
  Each renders the deployed source preview from the real post-OCR extraction
  and fails if a cited field has no box, or if a "View source region" link
  doesn't land on its box. Regression proof:
  `docs/agentforge/evidence/E0-extension-gate-regression.txt`.
- `x5-retrieval-lexical-hgb-question` and
  `x5-retrieval-hybrid-fallback-both-findings` (E3, `retrieval.js`) run a
  scan through the `local-lexical` retriever and through the deployed hybrid
  retriever with a failing embed call (its `sparse_only` fallback). They fail
  if the lab-test query expansion is off: the hgb question no longer ranks an
  anemia chunk first, and the low hemoglobin on `gen-lab-d-flags` gets no
  anemia guideline in the top 3. Regression proof:
  `docs/agentforge/evidence/E3-retrieval-regression.txt`.
- Critic cases (E2, `extensionCases/critic.js`), nine of them:
  `x2-critic-rejects-uncited-statement`, `x2-critic-rejects-unsafe-directive`,
  `x2-critic-keeps-clean-answer`, `x2-critic-ignores-added-or-rewritten-claims`,
  `x2-critic-rejected-fact-not-reinserted`, `x2-critic-budget-skip-labeled`,
  `x2-critic-invalid-json-failed`, `x2-critic-disabled-labeled` and
  `x2-critic-no-phi`. They run the real scan
  path with a fake critic model (`scriptedFakeCritic`) that rejects exactly the
  claim a case planted. The planted claims pass `verifyClaims`, so they ship
  if the critic step is skipped or accepts everything. The not-reinserted case
  vetoes every claim citing the chart's lisinopril facts and fails if a claim
  citing them comes back or if `critic_rejected` differs from what was removed.
  These cases test the
  veto wiring, labels and trace, not a real model's judgment; that is what
`scripts/benchmark-critic-models.mjs` measures. Regression proof:
  `docs/agentforge/evidence/E2-critic-regression.txt`.
- `x3-*` (E4, 15 cases, `extensionCases/medicationList.js`): the
  `medication_list` type on two new golden PDFs (`medlist-a` vector,
  `medlist-b` rasterized): typed `MedicationList`, verbatim row citations,
  values against hand-written truth, a medication list and a lab or intake
  form declared as each other never `READY`, a blank page `BLOCKED`, another
  patient's list `BLOCKED`, a drug row with no row label `QUALIFIED`, and no drug names or identity in traces or logs.
  Its documents are listed in `test/fixtures/golden/extension-manifest.json`;
  `readGolden()` loads them next to the golden set but only the extension
  suite's hash covers them, so the 50-case hash is unchanged. Regression
  proof: `docs/agentforge/evidence/E4-medlist-regression.txt`.
- E5 lab trend (`labTrend.js`), five cases. Each uploads `lab-a` and runs
  the service calls in the server's order, including the fixture-mode lab
  persistence, then reads the trend back. `x4-lab-trend-two-points-in-date-order`
  uploads `lab-c` (collected earlier, extension-only document in
  `test/fixtures/golden/extension-manifest.json`) and needs two points per test
  in date order with the truth values. `x4-lab-trend-point-citations` needs a
  5-key citation per point to its own document, landing on a box in that
  document's preview. `x4-lab-trend-mixed-units-split` needs g/dL and g/L
  results charted as separate series. `x4-lab-trend-cross-patient` needs a
  patient-2 context refused, and a lab report BLOCKED for a header mismatch
  kept out of patient 2's trend. `x4-lab-trend-no-phi` checks the whole flow's
  stdout, stderr and traces. The gate runs the in-memory synthetic lab store;
  the OpenEMR module path is covered by `agentforge/test/lab-trend.test.js`
  against the fake module. Regression proof:
  `docs/agentforge/evidence/E5-lab-trend-regression.txt`.
- `x8-scope-other-patient-question` (E8, `extensionCases/scope.js`,
  `safe_refusal`): on patient 001's lab report, "What medications is Test
  Conflict on?" must be refused `out_of_scope_patient`, with no answer
  composed, the document's extraction kept, and no other patient's data in
  the result. Regression proof:
  `docs/agentforge/evidence/E8-w1-trust-regression.txt`.
- F-CLIN clinical rules and "not documented" answers
  (`extensionCases/clinicalRules.js`), 13 cases. The inputs are synthetic:
  the committed `lab-a` and `intake-a` OCR recordings with edited lines,
  replayed for the same PDF bytes through `service_overrides`. No new fixture
  document is added, so neither manifest changes.
  - `xc-fc-01-critical-potassium-flag`: potassium 6.8 mmol/L must give one
    `critical_value` flag. The flag cites the result's document citation, and
    the trace carries the code but not the value.
  - `xc-fc-02-normal-potassium-no-flag`: 4.2 mmol/L must give no flag.
  - `xc-fc-03-a1c-diabetes-range-flag`: `lab-b` A1C 7.2 % must give a
    `diabetes_range` flag citing the result and the CDC chunk.
  - `xc-fc-04-a1c-below-range-no-flag`: 6.1 % must give no flag.
  - `xc-fc-05-penicillin-amoxicillin-conflict`: must give one
    `drug_allergy_conflict` flag citing both form lines.
  - `xc-fc-06-penicillin-metformin-no-conflict`: must give no flag.
  - `xc-fc-07-allergy-with-no-known-food-allergies`: "Penicillin - hives; no
    known food allergies" with amoxicillin must still give the conflict flag.
  - `xc-sr-05-flag-grounding-fails-verification`: a medication line with an
    instruction ("Stop taking if rash") must not ship a flag. The drop must be
    counted in `safety_flags_dropped` and in the trace.
  - `xc-sr-06-potassium-flag-contradicts-range`: 6.8 mmol/L printed
    "abnormal: No" must go to needs review.
  - `xc-sr-01-a1c-flag-contradicts-range`: 6.8 % printed "abnormal: No"
    must go to needs review and not be stated.
  - `xc-sr-02-potassium-unit-unrecognized`: a potassium in mg/dL must go to
    needs review.
  - `xc-sr-03-scan-bp-not-documented`: "What was the blood pressure?" on a
    scan must be answered "not available from the sources read" (vitals are
    not retrieved), must not claim the value is absent, and must list no
    other claims.
  - `xc-sr-04-followup-bp-not-documented`: the same question as a briefing
    follow-up.

  The no-flag cases also require that the value is stated, so a rule that
  never ran cannot pass them. Regression proof:
  `docs/agentforge/evidence/F-CLIN-regression.txt`.
- To rebaseline: `npm run eval:extensions --prefix agentforge --
  --update-baseline`. As with the golden gate, it refuses unless every
  threshold is met.

## H5 mutation table (2026-10-01)

Layers that fail for each mutation, before (`9b25806c`) and after H5. Raw
exit codes and the hook transcripts:
[`docs/agentforge/evidence/H5-gate-integrity-regression.txt`](docs/agentforge/evidence/H5-gate-integrity-regression.txt).

| Mutation | Before | After |
| --- | --- | --- |
| m1 abnormal flag always `normal` | unit, gate, ext | unit, gate, ext, OCR step |
| m2 redactor stops stripping `value` | obs, gate (np-10 only), ext | obs, gate (8 no_phi cases), ext |
| m3 critic never vetoes | unit, ext | unit, ext (critic is off in the 50 cases) |
| m4 zero facts not blocking | unit, gate, ext | unit, gate, ext |
| m5 g/dL reported as g/L | unit, gate, ext | unit, gate, ext, OCR step |
| m6 verifier anchors uncited claims | unit | unit, gate (fc-08), ext |
| m7 pdftoppm 200 to 72 DPI | nothing | OCR step (hook refuses the commit) |
| m8 test name and range in the trace metrics | unit | unit, gate (4 no_phi cases), ext |
| m9 composer ships low-confidence facts | unit, gate, ext | unit, gate, ext |
| m10 verifier ignores numbers | nothing | ext (`xh5-judge-number-not-in-cited-source`) |
| m11 a check function loosened | nothing | gate, ext (case-set hash) |
| m12 oracle back to `some` | (was the code) | evals |
| m13 redactor misses typed lab keys | (was the code) | obs, gate, ext |
| m14 OCR default back to psm 6 | (was the code) | OCR step |

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
  with the recordings by the parity test, which the hook runs natively or in
  Docker and CI runs with `AGENTFORGE_REQUIRE_OCR=1`. Only a host with neither
  the tools nor Docker skips it, loudly, and only for commits that do not touch
  the OCR path. The Docker image is built from the floating `node:24-alpine`
  tag, so a Tesseract or poppler upgrade there shows up as parity drift, not as
  a gate failure.
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
- **Retrieval.** Dense scores and rerank order are real but recorded, not
  live: a change in the live Gemini or Qwen models is not seen until the
  fixtures are re-recorded (`scripts/record-retrieval-fixtures.mjs`). Retrieval
  assertions check the top source, ordering and empty-for-off-topic; they are
  not a graded relevance benchmark.
- **Answers.** Five cases assert the S6 grounded answer (`fc-01`, `cp-05`,
  `fc-05`, `fc-08`, `sr-07`), judge every claim with the independent claim
  judge and re-check it with the S7 verifier. The answer is composed deterministically (or by a fake model in
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

**Pushes are gated too.** `.githooks/pre-push` runs the 50-case gate and the extension suite before every `git push` and refuses the push if either fails, so a regression cannot reach the remote or a merge request. Proof: `docs/agentforge/evidence/W2_PREPUSH_BLOCK.txt` (a planted `abnormal_flag: 'normal'` regression fails fc-01, fc-02, fc-03 and fc-11, and the push is blocked with exit 1; the clean tree passes).


[`W2_PRECOMMIT_BLOCK.png`](docs/agentforge/evidence/W2_PRECOMMIT_BLOCK.png) and
its [raw transcript](docs/agentforge/evidence/W2_PRECOMMIT_BLOCK.txt) come from
the superseded v2 gate: its text-fixture cases, with `0.1` added to extracted lab
values. [`W2_PRECOMMIT_BLOCK_V3.txt`](docs/agentforge/evidence/W2_PRECOMMIT_BLOCK_V3.txt)
is the hook transcript for this gate (as of commit 1c10893), rejecting a commit
that carries regression R3 (the abnormal flag is always `normal`).
