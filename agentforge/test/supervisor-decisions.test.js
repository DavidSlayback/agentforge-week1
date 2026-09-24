import test from 'node:test';
import assert from 'node:assert/strict';
import { DECISIONS, decideNext, isRecordLookupQuestion, runActiveSupervisor } from '../src/supervisor.js';

/**
 * S6: `decideNext` routing decisions and the loop that acts on them.
 *
 * `decideNext` itself is a pure function -- most of the routing-variant
 * coverage below calls it directly with hand-built state. The remaining
 * tests drive `runActiveSupervisor` end to end (real extraction + evidence
 * workers) to prove the loop wires those decisions to actual behavior:
 * extraction caching, the one-shot low-confidence OCR retry, and the
 * record-lookup-only retrieval skip.
 */

test('decideNext: extraction_needed is the default when nothing has run yet', () => {
  assert.deepEqual(decideNext({}), { next: DECISIONS.EXTRACT, reason: 'extraction_needed' });
});

test('decideNext: extraction_cached is still an EXTRACT decision (the trace reads truthfully: an extraction happened, from cache)', () => {
  assert.deepEqual(decideNext({ extraction: null, extractionCached: true }), { next: DECISIONS.EXTRACT, reason: 'extraction_cached' });
});

test('decideNext: a fail-loud safety-blocking reason stops at DONE, not RETRIEVE or ANSWER', () => {
  assert.deepEqual(decideNext({ extraction: { output_status: 'complete' }, safetyBlocking: ['patient_mismatch'] }), { next: DECISIONS.DONE, reason: 'patient_mismatch' });
  assert.deepEqual(decideNext({ extraction: { output_status: 'complete' }, safetyBlocking: ['no_fields_extracted'] }), { next: DECISIONS.DONE, reason: 'no_fields_extracted' });
});

test('decideNext: low_confidence_retry fires once when mean confidence is below 0.7, never twice', () => {
  const state = { extraction: { output_status: 'complete' }, safetyBlocking: [], confidenceSummary: { mean: 0.5, min: 0.4, count: 2 } };
  assert.deepEqual(decideNext(state), { next: DECISIONS.EXTRACT, reason: 'low_confidence_retry' });
  assert.deepEqual(decideNext({ ...state, ocrRetryUsed: true }), { next: DECISIONS.RETRIEVE, reason: 'evidence_needed' });
});

test('decideNext: confidence at or above 0.7 never triggers a retry', () => {
  const state = { extraction: { output_status: 'complete' }, safetyBlocking: [], confidenceSummary: { mean: 0.7, min: 0.7, count: 1 } };
  assert.deepEqual(decideNext(state), { next: DECISIONS.RETRIEVE, reason: 'evidence_needed' });
});

test('decideNext: record_lookup_only skips RETRIEVE and goes straight to ANSWER', () => {
  const state = { extraction: { output_status: 'complete' }, safetyBlocking: [], confidenceSummary: { mean: 0.9 }, recordLookupOnly: true };
  assert.deepEqual(decideNext(state), { next: DECISIONS.ANSWER, reason: 'record_lookup_only' });
});

test('decideNext: an ordinary question still routes to RETRIEVE, not ANSWER', () => {
  const state = { extraction: { output_status: 'complete' }, safetyBlocking: [], confidenceSummary: { mean: 0.9 }, recordLookupOnly: false };
  assert.deepEqual(decideNext(state), { next: DECISIONS.RETRIEVE, reason: 'evidence_needed' });
});

test('decideNext: ANSWER once facts and evidence are both ready', () => {
  const state = { extraction: { output_status: 'complete' }, safetyBlocking: [], confidenceSummary: { mean: 0.9 }, evidence: { output_status: 'ready' } };
  assert.deepEqual(decideNext(state), { next: DECISIONS.ANSWER, reason: 'facts_and_evidence_ready' });
});

test('decideNext: max_steps_reached caps the loop regardless of any other state', () => {
  assert.deepEqual(decideNext({ stepCount: 6, maxSteps: 6, extraction: null }), { next: DECISIONS.DONE, reason: 'max_steps_reached' });
  assert.deepEqual(decideNext({ stepCount: 6, maxSteps: 6, extraction: { output_status: 'complete' }, evidence: { output_status: 'ready' } }), { next: DECISIONS.DONE, reason: 'max_steps_reached' });
});

test('isRecordLookupQuestion: matches direct value/result/level questions, not open-ended ones', () => {
  assert.equal(isRecordLookupQuestion('What was the hemoglobin value?'), true);
  assert.equal(isRecordLookupQuestion('what is the a1c result'), true);
  assert.equal(isRecordLookupQuestion('What were the glucose levels?'), true);
  assert.equal(isRecordLookupQuestion('What changed since the last visit?'), false);
  assert.equal(isRecordLookupQuestion('documented glycemic values medication adherence'), false);
  assert.equal(isRecordLookupQuestion(''), false);
  assert.equal(isRecordLookupQuestion(undefined), false);
});

// F5 review fix: a question that otherwise matches the "what is/was the X
// value/result/level" shape but actually asks for guideline evidence (a
// target, a recommendation, an interpretation) must still route to RETRIEVE.
test('isRecordLookupQuestion: guideline-seeking questions (target/goal/recommended/normal/should/abnormal) are not a record lookup', () => {
  const cases = [
    ['What is the target A1C value?', false],
    ['What is the recommended potassium level?', false],
    ['What is the normal hemoglobin result?', false],
    ['What is the abnormal glucose value?', false],
    ['What should the glucose level be?', false],
    ['What is the goal blood pressure reading?', false],
    // Still real lookups: no guideline-seeking word present.
    ['What was the hemoglobin value?', true],
    ['What is the potassium result?', true],
  ];
  for (const [question, expected] of cases) assert.equal(isRecordLookupQuestion(question), expected, question);
});

test('answerComposer.js re-exports the same isRecordLookupQuestion as supervisor.js (one canonical copy)', async () => {
  const composer = await import('../src/answerComposer.js');
  assert.equal(composer.isRecordLookupQuestion, isRecordLookupQuestion);
});

const envelope = (fields) => {
  const lines = ['SYNTHETIC_SCAN_FORM|layout=pdf-ocr-lab_pdf|page_count=1'];
  for (const [fieldId, label, value, unit, confidence] of fields) {
    lines.push(`FIELD|field_id=${fieldId}|label=${label}|value=${value}|unit=${unit}|quote=${label}: ${value}|page=1|box=0,0,10,10|confidence=${confidence.toFixed(2)}`);
  }
  return Buffer.from(lines.join('\n'));
};
const hgbFields = (confidence) => [
  ['lab.hgb.test_name', 'Hemoglobin test name', 'Hemoglobin', '', confidence],
  ['lab.hgb.value', 'Hemoglobin value', '13.2', 'g/dL', confidence],
  ['lab.hgb.unit', 'Hemoglobin unit', 'g/dL', '', confidence],
  ['lab.hgb.reference_range', 'Hemoglobin reference range', '12.0-15.5', '', confidence],
  ['lab.hgb.collection_date', 'Hemoglobin collection date', '2026-01-05', '', confidence],
  ['lab.hgb.abnormal', 'Hemoglobin abnormal', 'normal', '', confidence],
];
const LAB_QUERY = 'documented glycemic values medication adherence';

test('active supervisor: a shared extractionCache skips EXTRACT on the second call for the same document and OCR mode', async () => {
  const extractionCache = new Map();
  const args = { sourceDocumentId: 'doc-cache-1', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope(hgbFields(0.95)), query: LAB_QUERY, extractionCache };
  const first = await runActiveSupervisor(args);
  assert.deepEqual(first.decisions[0], { next: 'EXTRACT', reason: 'extraction_needed' });
  const second = await runActiveSupervisor(args);
  assert.deepEqual(second.decisions[0], { next: 'EXTRACT', reason: 'extraction_cached' });
  // The cached extraction is reused verbatim -- same typed facts.
  assert.deepEqual(second.typed_outputs.extraction.lab_results, first.typed_outputs.extraction.lab_results);
});

test('active supervisor: a different OCR mode is not served from another mode\'s cache entry', async () => {
  const extractionCache = new Map();
  await runActiveSupervisor({ sourceDocumentId: 'doc-cache-2', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope(hgbFields(0.95)), query: LAB_QUERY, extractionCache, ocrMode: 'psm6' });
  const differentMode = await runActiveSupervisor({ sourceDocumentId: 'doc-cache-2', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope(hgbFields(0.95)), query: LAB_QUERY, extractionCache, ocrMode: 'psm4' });
  assert.deepEqual(differentMode.decisions[0], { next: 'EXTRACT', reason: 'extraction_needed' });
});

test('active supervisor: low mean confidence triggers exactly one re-extraction with the alternate-OCR content, recorded as a decision', async () => {
  let retryCalls = 0;
  const reextractWithAlternateOcr = async () => { retryCalls += 1; return { content: envelope(hgbFields(0.95)), ocrMode: 'psm4' }; };
  const result = await runActiveSupervisor({ sourceDocumentId: 'doc-retry-1', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope(hgbFields(0.5)), query: LAB_QUERY, reextractWithAlternateOcr });
  const retryDecisions = result.decisions.filter((decision) => decision.reason === 'low_confidence_retry');
  assert.equal(retryDecisions.length, 1);
  assert.equal(retryCalls, 1);
  // The retried extraction (high confidence) is what the workflow reports.
  assert.equal(result.typed_outputs.extraction.lab_results[0].confidence, 0.95);
});

test('active supervisor: a low-confidence retry with no usable alternate content keeps the original extraction and never loops', async () => {
  const reextractWithAlternateOcr = async () => null;
  const result = await runActiveSupervisor({ sourceDocumentId: 'doc-retry-2', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope(hgbFields(0.5)), query: LAB_QUERY, reextractWithAlternateOcr });
  const retryDecisions = result.decisions.filter((decision) => decision.reason === 'low_confidence_retry');
  assert.equal(retryDecisions.length, 1);
  assert.equal(result.typed_outputs.extraction.lab_results[0].confidence, 0.5);
});

test('active supervisor: a low-confidence retry with no retry seam at all is a safe no-op, not a crash', async () => {
  const result = await runActiveSupervisor({ sourceDocumentId: 'doc-retry-3', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope(hgbFields(0.5)), query: LAB_QUERY });
  // No documentText/targetPatient given, so identity stays unverified -- QUALIFIED, never a crash or BLOCKED.
  assert.equal(result.final_state, 'QUALIFIED');
  assert.equal(result.typed_outputs.extraction.lab_results[0].confidence, 0.5);
});

test('active supervisor: a pure record-lookup question skips retrieval entirely', async () => {
  const result = await runActiveSupervisor({ sourceDocumentId: 'doc-lookup-1', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope(hgbFields(0.95)), query: 'What was the hemoglobin value?' });
  assert.deepEqual(result.decisions.map((decision) => decision.reason), ['extraction_needed', 'record_lookup_only']);
  assert.equal(result.typed_outputs.evidence, null);
  assert.equal(result.handoffs.length, 1);
  // Readiness rests on facts alone (no documentText/targetPatient given here,
  // so identity stays unverified -- QUALIFIED, not BLOCKED, and never READY
  // by accident because retrieval never ran).
  assert.equal(result.final_state, 'QUALIFIED');
  assert.ok(result.qualification.reasons.includes('patient_identity_unverified'));
});

test('active supervisor: an ordinary follow-up question still retrieves evidence (unchanged behavior)', async () => {
  const result = await runActiveSupervisor({ sourceDocumentId: 'doc-lookup-2', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope(hgbFields(0.95)), query: LAB_QUERY });
  assert.deepEqual(result.decisions.map((decision) => decision.reason), ['extraction_needed', 'evidence_needed', 'facts_and_evidence_ready']);
  assert.ok(result.typed_outputs.evidence);
  assert.equal(result.handoffs.length, 2);
});

test('active supervisor: every decision is also recorded on the observer trace, redaction-safe (codes only)', async () => {
  const recorded = [];
  const observer = { startStage() {}, finishStage() {}, setExtraction() {}, recordRetrievalAttempt() {}, recordDecision: (decision) => recorded.push(decision) };
  await runActiveSupervisor({ sourceDocumentId: 'doc-trace-1', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope(hgbFields(0.95)), query: LAB_QUERY, observer });
  assert.deepEqual(recorded.map((decision) => decision.reason), ['extraction_needed', 'evidence_needed', 'facts_and_evidence_ready']);
  assert.ok(recorded.every((decision) => Object.keys(decision).every((key) => ['next', 'reason'].includes(key))));
});

// F6 review fix: the retry must never make things worse.
test('active supervisor: a retry with lower confidence than the original is discarded, not adopted', async () => {
  const reextractWithAlternateOcr = async () => ({ content: envelope(hgbFields(0.3)), ocrMode: 'psm4' });
  const result = await runActiveSupervisor({ sourceDocumentId: 'doc-retry-worse-confidence', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope(hgbFields(0.6)), query: LAB_QUERY, reextractWithAlternateOcr });
  assert.equal(result.typed_outputs.extraction.lab_results[0].confidence, 0.6);
  assert.equal(result.ocr_mode, 'psm6');
});

test('active supervisor: a retry that comes back contract-invalid (blocked) never replaces the original valid extraction', async () => {
  // `lab.bogus.value` is not in the pdf-ocr-lab_pdf allowlist, so this
  // extraction is contract-invalid (`blocked`) regardless of its confidence.
  const badContent = envelope([['lab.bogus.value', 'Bogus value', '1', '', 0.99]]);
  const reextractWithAlternateOcr = async () => ({ content: badContent, ocrMode: 'psm4' });
  const result = await runActiveSupervisor({ sourceDocumentId: 'doc-retry-blocked-candidate', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope(hgbFields(0.5)), query: LAB_QUERY, reextractWithAlternateOcr });
  assert.notEqual(result.final_state, 'BLOCKED');
  assert.equal(result.typed_outputs.extraction.lab_results[0].confidence, 0.5);
  assert.equal(result.ocr_mode, 'psm6');
});

test('active supervisor: a retry with higher confidence is adopted and the reported ocr_mode reflects the extraction actually used', async () => {
  const reextractWithAlternateOcr = async () => ({ content: envelope(hgbFields(0.95)), ocrMode: 'psm4' });
  const result = await runActiveSupervisor({ sourceDocumentId: 'doc-retry-better-confidence', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope(hgbFields(0.5)), query: LAB_QUERY, reextractWithAlternateOcr });
  assert.equal(result.typed_outputs.extraction.lab_results[0].confidence, 0.95);
  assert.equal(result.ocr_mode, 'psm4');
});

// F11 review fix: content-addressed cache (not document-id-addressed), bounded, and truthfully traced.
test('active supervisor: extractionCache is content-addressed, so a different sourceDocumentId with identical content still hits the cache', async () => {
  const extractionCache = new Map();
  const content = envelope(hgbFields(0.95));
  await runActiveSupervisor({ sourceDocumentId: 'doc-content-a', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content, query: LAB_QUERY, extractionCache });
  const result = await runActiveSupervisor({ sourceDocumentId: 'doc-content-b', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content, query: LAB_QUERY, extractionCache });
  assert.deepEqual(result.decisions[0], { next: 'EXTRACT', reason: 'extraction_cached' });
});

test('active supervisor: a cache hit still records extraction confidence on the trace (setExtraction is called)', async () => {
  const extractionCache = new Map();
  const content = envelope(hgbFields(0.95));
  await runActiveSupervisor({ sourceDocumentId: 'doc-setext-a', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content, query: LAB_QUERY, extractionCache });
  const setExtractionCalls = [];
  const observer = { startStage() {}, finishStage() {}, recordRetrievalAttempt() {}, setExtraction: (value) => setExtractionCalls.push(value) };
  await runActiveSupervisor({ sourceDocumentId: 'doc-setext-b', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content, query: LAB_QUERY, extractionCache, observer });
  assert.equal(setExtractionCalls.length, 1);
  assert.equal(setExtractionCalls[0].confidence.mean, 0.95);
});

test('active supervisor: extractionCache evicts the oldest entry once it exceeds its bound (50)', async () => {
  const extractionCache = new Map();
  for (let i = 0; i < 51; i += 1) {
    const fields = hgbFields(0.95).map((field) => [...field]);
    fields[1][2] = String(13 + i); // unique value per iteration -> unique content -> unique cache key
    await runActiveSupervisor({ sourceDocumentId: `doc-bound-${i}`, documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope(fields), query: LAB_QUERY, extractionCache });
  }
  assert.ok(extractionCache.size <= 50, `expected extractionCache.size <= 50, got ${extractionCache.size}`);
});
