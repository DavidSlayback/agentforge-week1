/**
 * Offline measurement for three KEY_METRICS.md rows marked *pending*:
 * abnormal-finding recall, extraction accuracy, and citation resolvability
 * (offline half). `npm run eval:metrics` (or `node scripts/measure-key-metrics.mjs`).
 *
 * This deliberately reuses the W2 gate's own machinery -- the same golden
 * PDFs/text envelopes, the same recorded-OCR replay, the same hand-written
 * truth files, and (for extraction accuracy) the gate's own field-comparison
 * functions (`checkLabFacts`/`checkIntakeFacts`) -- rather than a second,
 * independent copy of "does this match truth" that could silently drift from
 * what the 50-case gate itself checks. `src/w2RegressionGate.js` exports
 * `harness`/`runScenario`/`extractionOf`/`checkLabFacts`/`checkIntakeFacts`/
 * `citationIssues`/`factCitationKey`/`intakeLeavesOf` for exactly this reuse;
 * none of their own behavior changed to enable it.
 *
 * Every document is run through the *deployed* scan path (real
 * `AgentForgeService`, recorded Tesseract OCR replay, real field mapping and
 * typed extraction) exactly like the gate does, but with no answer model
 * configured -- `harness()`'s default `answerProvider: null` means
 * `composeGroundedAnswer` always takes the deterministic path. That is
 * intentional and load-bearing, not a shortcut: there is no live model to
 * call offline, so every score this script reports is against the
 * deterministic composer's own answer, never a model's. The output says so
 * explicitly (`answer_composer: 'deterministic'`) so a reader can never
 * mistake this for the "model grounding rate" metric (KEY_METRICS.md; that
 * one needs a live deployment and is `scripts/measure-live-metrics.mjs`'s job).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildW2GoldenSet,
  checkIntakeFacts,
  checkLabFacts,
  citationIssues,
  extractionOf,
  factCitationKey,
  harness,
  intakeLeavesOf,
  runScenario,
} from '../src/w2RegressionGate.js';
import { loadGuidelineCorpus } from '../src/guidelineEvidence.js';

/**
 * One canonical, non-adversarial scenario per golden document -- the case id
 * from `buildW2GoldenSet()` whose scenario reads that document under its own
 * true declared type and true patient (never one of the gate's deliberate
 * mismatch/contradiction cases, e.g. never sr-13's "lab report uploaded under
 * the wrong patient"). Only `.scenario` is used from each case; its own
 * `.expect` block (written for a different purpose -- the 50-case rubric) is
 * never read here.
 *
 * Rationale per document, so a reviewer can audit the choice without
 * re-deriving it from `buildW2GoldenSet()`:
 *   - lab-a/lab-b/intake-a/intake-b/gen-lab-d-flags/gen-lab-e-scanned: the
 *     `factually_consistent` case for that document IS the genuine reading
 *     (correct declared_type, default patient fixture-patient-001).
 *   - gen-intake-c-conflict: fc-07 uploads it to fixture-patient-002, which
 *     is that document's own truth `patient_ref` -- the genuine reading.
 *     (sr-05 uploads the same document to fixture-patient-001 on purpose, to
 *     exercise patient-mismatch detection; that is not this document's own
 *     truth and is excluded here.)
 *   - gen-lab-c-table/gen-blank-page/gen-corrupt/gen-intake-d-dob: no
 *     `factually_consistent` case exists (they are refusal-by-design
 *     documents); their `safe_refusal` case already uses the correct
 *     declared_type and is not an artificial mismatch -- sr-01/sr-02/sr-09
 *     read each document as what it actually is, and sr-11 uploads
 *     gen-intake-d-dob under the patient its own printed name claims
 *     (fixture-patient-001), which is the document's own DOB-mismatch
 *     property, not a test-only substitution.
 *   - scan-text-lab-a/scan-text-intake-a: no `factually_consistent` case
 *     exists for either (only `schema_valid`/`citation_present` cover them);
 *     sv-11/cp-12 both use the correct declared_type and default patient.
 */
export const CANONICAL_CASE_BY_DOCUMENT = Object.freeze({
  'lab-a': 'fc-01-lab-a-values',
  'lab-b': 'fc-02-lab-b-values',
  'gen-lab-d-flags': 'fc-03-lab-d-high-low',
  'gen-lab-e-scanned': 'fc-04-lab-e-scan-values',
  'intake-a': 'fc-05-intake-a-values',
  'intake-b': 'fc-06-intake-b-values',
  'gen-intake-c-conflict': 'fc-07-intake-own-patient',
  'gen-lab-c-table': 'sr-01-table-lab-zero-fields',
  'gen-blank-page': 'sr-02-blank-page',
  'gen-corrupt': 'sr-09-corrupt-pdf',
  'gen-intake-d-dob': 'sr-11-intake-dob-mismatch',
  'scan-text-lab-a': 'sv-11-scan-text-lab-typed',
  'scan-text-intake-a': 'cp-12-scan-text-intake-citations',
});

/** Intake truth keys the deployed intake composer/needs_review path ever
 * tracks at all (`answerComposer.js#collectIntakeLeaves` -- chief concern,
 * medications, allergies, family history). Demographics (name/dob/phone) are
 * deliberately excluded from the answer's own claims (F8 review fix) and so
 * can never appear in `needs_review` either; they are still graded for
 * extraction accuracy (a pure typed-extraction quality question, independent
 * of what the answer composer chooses to surface) but excluded from the
 * review-share and recall metrics, which are both about the answer. */
const COMPOSER_TRACKED_INTAKE_KEYS = ['chief_concern', 'current_medications', 'allergies', 'family_history'];
const ALL_INTAKE_SCALAR_KEYS = ['name', 'dob', 'phone', 'chief_concern'];
const ALL_INTAKE_LIST_KEYS = ['current_medications', 'allergies', 'family_history'];

const norm = (value) => String(value ?? '').trim().toLowerCase();

function labFieldOrChunkId(labResult) {
  return labResult?.citation?.field_or_chunk_id || labResult?.test_name || null;
}

/**
 * Run one canonical case end to end (the real deployed scan path, no answer
 * model) and score it against its own truth file for extraction accuracy,
 * abnormal-finding recall, and offline citation resolvability. Exported so a
 * test can exercise the core logic on a single golden case without running
 * the full set.
 */
export async function scoreDocumentCase(testCase) {
  const docId = testCase.scenario.doc;
  const run = await runScenario(testCase.scenario);
  const truth = run.docs[0].truth;
  const extraction = extractionOf(run);
  const answer = run.result?.workflow?.answer || null;

  // --- Extraction accuracy: lab fields (all 5 keys must match to count) ---
  // checkLabFacts (like the gate itself) assumes a lab_pdf-shaped truth file
  // (`truth.lab_results` always an array, even if empty); it is only called
  // when that key is actually present, so an intake-only document's truth
  // file (no `lab_results` key at all) never reaches it.
  const labIssues = truth.lab_results ? new Set(checkLabFacts(run, {})) : new Set();
  const labFields = (truth.lab_results || []).map((expected) => {
    const matched = (extraction?.lab_results || []).find((result) => norm(result.test_name) === norm(expected.test_name));
    const keyIssues = ['value', 'unit', 'reference_range', 'collection_date', 'abnormal_flag']
      .map((key) => `lab_${key}_mismatch:${expected.test_name}`)
      .concat([`lab_result_missing:${expected.test_name}`]);
    const hit = !keyIssues.some((issue) => labIssues.has(issue));
    return { document: docId, field: `lab:${expected.test_name}`, hit, extracted: matched || null };
  });

  // --- Extraction accuracy: intake fields (per-key equality with truth) ---
  const intakeIssues = truth.intake_form ? new Set(checkIntakeFacts(run)) : new Set();
  const intakeFields = [];
  if (truth.intake_form) {
    for (const key of [...ALL_INTAKE_SCALAR_KEYS, ...ALL_INTAKE_LIST_KEYS]) {
      if (truth.intake_form[key] === undefined) continue;
      const hit = !intakeIssues.has('intake_form_missing') && !intakeIssues.has(`intake_${key}_mismatch`);
      intakeFields.push({ document: docId, field: `intake:${key}`, hit, key });
    }
  }

  // --- Review routing: only over fields the answer composer ever tracks
  // (lab results always; intake only its clinical-finding subset) ---
  const reviewFields = [];
  for (const labField of labFields) {
    if (!labField.extracted) { reviewFields.push({ ...labField, reviewed: false }); continue; }
    const fieldId = labFieldOrChunkId(labField.extracted);
    const reviewed = Boolean(answer?.needs_review?.some((item) => item.kind === 'lab_result' && item.field === fieldId));
    reviewFields.push({ ...labField, reviewed });
  }
  const trackedIntakeFields = intakeFields.filter((field) => COMPOSER_TRACKED_INTAKE_KEYS.includes(field.key));
  const intakeLeaves = intakeLeavesOf(extraction?.intake_form);
  for (const field of trackedIntakeFields) {
    // A leaf is "reviewed" if any composer-tracked leaf with this document's
    // low confidence ended up in needs_review at all -- individual leaves
    // inside a list (current_medications[n]) are not separately addressable
    // by key name, so this is reported at the whole-key granularity
    // extraction accuracy itself uses.
    const reviewed = Boolean(answer?.needs_review?.some((item) => item.kind === 'intake_field'
      && intakeLeaves.some((leaf) => leaf.citation?.field_or_chunk_id === item.field)));
    reviewFields.push({ ...field, reviewed });
  }

  // --- Abnormal-finding recall: abnormal/flagged labs + key intake items ---
  const recallItems = [];
  for (const expected of (truth.lab_results || [])) {
    if (norm(expected.abnormal_flag) === 'normal') continue;
    const matched = (extraction?.lab_results || []).find((result) => norm(result.test_name) === norm(expected.test_name));
    let hit = false;
    if (matched && answer) {
      const key = factCitationKey(matched.citation);
      const citedInClaim = answer.patient_facts.some((claim) => claim.citations.some((citation) => factCitationKey(citation) === key));
      const listedForReview = answer.needs_review.some((item) => item.kind === 'lab_result' && item.field === labFieldOrChunkId(matched));
      hit = citedInClaim || listedForReview;
    }
    recallItems.push({ document: docId, field: `lab:${expected.test_name}`, hit });
  }
  if (truth.intake_form) {
    // Pairing by position: the composer-tracked leaves are collected in the
    // same fixed order (chief_concern, then medications, then allergies --
    // `answerComposer.js#collectIntakeLeaves`/`intakeLeavesOf`) as this truth
    // list is built here, so index alignment holds unless a leaf was
    // dropped, which itself is the miss this recall metric exists to catch
    // (a shorter observed-leaves list than truth naturally leaves the tail
    // unmatched below).
    const truthLeaves = [
      truth.intake_form.chief_concern ? [['chief_concern', truth.intake_form.chief_concern]] : [],
      (truth.intake_form.current_medications || []).map((value, index) => [`current_medications[${index}]`, value]),
      (truth.intake_form.allergies || []).map((value, index) => [`allergies[${index}]`, value]),
    ].flat();
    let leafIndex = 0;
    for (const [label] of truthLeaves) {
      const observedLeaf = intakeLeaves[leafIndex];
      leafIndex += 1;
      let hit = false;
      if (observedLeaf?.citation && answer) {
        const key = factCitationKey(observedLeaf.citation);
        const citedInClaim = answer.patient_facts.some((claim) => claim.citations.some((citation) => factCitationKey(citation) === key));
        const listedForReview = answer.needs_review.some((item) => item.kind === 'intake_field' && item.field === observedLeaf.citation.field_or_chunk_id);
        hit = citedInClaim || listedForReview;
      }
      recallItems.push({ document: docId, field: `intake:${label}`, hit });
    }
  }

  // --- Citation resolvability (offline): every claim this run's answer shipped ---
  const corpus = loadGuidelineCorpus();
  const resolvability = [];
  if (answer) {
    for (const claim of [...answer.patient_facts, ...answer.guideline_evidence]) {
      for (const citation of claim.citations) {
        resolvability.push(resolveCitation({ run, citation, corpus, kind: claim.kind, docId }));
      }
    }
  }

  // A form the gate itself defines as another patient's (expected BLOCKED
  // patient_mismatch) and that was in fact refused that way is a correct
  // safety outcome, not a missed finding: surfacing its findings on this chart
  // would be the failure. Recall excludes it and lists it separately.
  const correctlyRefusedOtherPatient = testCase.expect?.refusal?.stop_reason === 'patient_mismatch'
    && run.result?.workflow?.stop_reason === 'patient_mismatch';
  return { docId, labFields, intakeFields, reviewFields, recallItems, resolvability, hadAnswer: Boolean(answer), correctlyRefusedOtherPatient, finalState: run.result?.workflow?.final_state || run.result?.status || null };
}

/**
 * Whether one shipped claim's citation resolves to its exact source:
 *   - `guideline`: the corpus has a chunk with this `source_id`, that chunk
 *     carries a URL, and the citation's quote is verbatim inside the chunk's
 *     own text.
 *   - `openemr_record` / `synthetic_chart_fixture`: the chart (re-fetched from this run's own
 *     chart adapter, the same source `composeGroundedAnswer` read from) has
 *     a fact whose citation matches exactly -- there is no page/bounding-box
 *     concept for a chart record, so resolvability here means "the record
 *     really exists in the chart," not a rendered position.
 *   - `document`: reuses the gate's own `citationIssues` (5 keys present,
 *     source_id is this run's actual stored document, quote verbatim in the
 *     real OCR/source text, bounding box valid and inside the page, and for
 *     a PDF the box matches the actual quoted OCR line) -- zero issues means
 *     it resolves. For a non-PDF `.scan.txt` envelope there is no
 *     page-geometry source to check the box against, so a syntactically
 *     valid box (checked by `citationIssues` itself) is the most this offline
 *     check can confirm; this is stated here so it is never mistaken for a
 *     full page-render check.
 */
const CHART_RECORD_SOURCE_TYPES = new Set(['openemr_record', 'synthetic_chart_fixture']);

function resolveCitation({ run, citation, corpus, kind, docId }) {
  const base = { document: docId, claim_kind: kind, source_type: citation.source_type };
  if (citation.source_type === 'guideline') {
    const chunk = corpus.find((entry) => entry.source_id === citation.source_id);
    const resolved = Boolean(chunk && chunk.url && chunk.text.includes(citation.quote_or_value));
    return { ...base, resolved };
  }
  if (CHART_RECORD_SOURCE_TYPES.has(citation.source_type)) {
    // Synchronous-enough for our purposes: the fixture chart adapter never
    // does real I/O, so this is safe to treat as resolved-or-not without an
    // extra await plumbed through the caller (chart facts were already
    // fetched once, identically, when this run composed its own answer).
    return { ...base, resolved: true, note: 'a chart record has no page geometry; resolved by construction from the same chart read the answer used' };
  }
  const sourceId = run.sourceIds[0];
  const doc = run.docs[0];
  const issues = citationIssues('claim', citation, { sourceId, doc });
  return { ...base, resolved: issues.length === 0, issues: issues.length ? issues : undefined };
}

function sumRate(items) {
  const total = items.length;
  const hits = items.filter((item) => item.hit).length;
  return { hits, total, rate: total ? Number((hits / total).toFixed(4)) : null };
}

/** Run every canonical case and aggregate the three pending KEY_METRICS.md
 * rows. `caseIds` defaults to every mapped document; a test may pass a
 * one-document subset. */
export async function measureKeyMetrics({ caseIds } = {}) {
  const allCases = buildW2GoldenSet();
  const byId = new Map(allCases.map((testCase) => [testCase.id, testCase]));
  const wanted = caseIds || Object.values(CANONICAL_CASE_BY_DOCUMENT);

  const perDocument = [];
  for (const caseId of wanted) {
    const testCase = byId.get(caseId);
    if (!testCase) throw new Error(`MEASURE_KEY_METRICS_UNKNOWN_CASE:${caseId}`);
    perDocument.push(await scoreDocumentCase(testCase));
  }

  const labFields = perDocument.flatMap((doc) => doc.labFields);
  const intakeFields = perDocument.flatMap((doc) => doc.intakeFields);
  const reviewFields = perDocument.flatMap((doc) => doc.reviewFields);
  const recallItems = perDocument.filter((doc) => !doc.correctlyRefusedOtherPatient).flatMap((doc) => doc.recallItems);
  const allResolvability = perDocument.flatMap((doc) => doc.resolvability);
  // Chart-record citations "resolve" by construction offline (see
  // resolveCitation), so they would only inflate the rate; count them apart.
  const resolvability = allResolvability.filter((item) => !CHART_RECORD_SOURCE_TYPES.has(item.source_type));

  const refusalDocumentsCountedAsMisses = perDocument
    .filter((doc) => !doc.hadAnswer && (doc.labFields.length || doc.intakeFields.length))
    .map((doc) => ({ document: doc.docId, final_state: doc.finalState }));
  const documentsWithNoTypedTruthFields = perDocument
    .filter((doc) => doc.labFields.length === 0 && doc.intakeFields.length === 0)
    .map((doc) => doc.docId);

  const extractionAccuracy = {
    definition: 'Typed lab fields matching truth on value, unit, reference range, collection date AND abnormal flag (all 5 must match; a document refused before typed extraction produced fields, e.g. an unreadable table layout, counts its truth fields as misses here -- see refusal_documents_counted_as_misses) plus intake fields (name, dob, phone, chief_concern, current_medications, allergies, family_history) matching truth. Documents whose own truth file defines zero typed fields (blank page, corrupt upload) contribute nothing to the denominator -- see documents_with_no_typed_truth_fields -- because nothing was ever claimed to exist there, which is different from excluding a real miss.',
    lab: sumRate(labFields),
    intake: sumRate(intakeFields),
    combined: sumRate([...labFields, ...intakeFields]),
    review_share: {
      ...sumRate(reviewFields.map((field) => ({ hit: field.reviewed }))),
      scope: 'lab fields (always) plus only the intake keys the answer composer ever tracks (chief_concern, current_medications, allergies, family_history) -- demographics (name/dob/phone) can never appear in needs_review by design (F8: excluded from the answer entirely) and are not counted here, though they are counted in the accuracy numbers above.',
    },
    refusal_documents_counted_as_misses: refusalDocumentsCountedAsMisses,
    documents_with_no_typed_truth_fields: documentsWithNoTypedTruthFields,
    misses: [...labFields, ...intakeFields].filter((field) => !field.hit).map((field) => ({ document: field.document, field: field.field })),
  };

  const abnormalFindingRecall = {
    definition: 'Abnormal/flagged lab results (abnormal_flag != normal) plus key intake items (chief concern, each medication, each allergy) from the truth files. A hit is a verified patient_facts claim citing that exact fact, or a needs_review entry naming it. A document of this chart\'s patient that never reached the answer stage (blocked before the answer was composed) counts every one of its items as a miss -- silently dropping one counts as a miss, per KEY_METRICS.md. A form the gate defines as another patient\'s and that was correctly BLOCKED patient_mismatch is excluded (see excluded_correct_patient_mismatch_refusals): showing its findings here would be the failure.',
    answer_composer: 'deterministic',
    ...sumRate(recallItems),
    excluded_correct_patient_mismatch_refusals: perDocument.filter((doc) => doc.correctlyRefusedOtherPatient && doc.recallItems.length).map((doc) => ({ document: doc.docId, items: doc.recallItems.length })),
    documents_never_composed_an_answer: perDocument.filter((doc) => !doc.hadAnswer && !doc.correctlyRefusedOtherPatient && doc.recallItems.length).map((doc) => doc.docId),
    misses: recallItems.filter((item) => !item.hit).map((item) => ({ document: item.document, field: item.field })),
  };

  const citationResolvabilityOffline = {
    definition: 'Share of this run\'s (deterministic-composer) answer claims whose citation resolves to its exact source: a document/`.scan.txt` field\'s bounding box lies within its page and matches the real quoted OCR line (guideline: the corpus has that chunk, it carries a URL, and the quote is verbatim in it; openemr_record: the fact really exists in the chart this run read).',
    ...sumRate(resolvability.map((item) => ({ hit: item.resolved }))),
    chart_record_citations_not_scored: allResolvability.length - resolvability.length,
    unresolved: resolvability.filter((item) => !item.resolved).map(({ document, claim_kind, source_type, issues }) => ({ document, claim_kind, source_type, issues })),
  };

  return {
    schema_version: 'agentforge-key-metrics-offline-v1',
    synthetic_only: true,
    documents_scored: perDocument.map((doc) => doc.docId),
    abnormal_finding_recall: abnormalFindingRecall,
    extraction_accuracy: extractionAccuracy,
    citation_resolvability_offline: citationResolvabilityOffline,
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const report = await measureKeyMetrics();
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes('--write')) {
    const outPath = fileURLToPath(new URL('../../docs/agentforge/evidence/W2_KEY_METRICS_OFFLINE.json', import.meta.url));
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    console.error(`Written: ${outPath}`);
  }
}
