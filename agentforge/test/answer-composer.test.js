import test from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicAnswerComposer, LOW_CONFIDENCE_THRESHOLD, composeGroundedAnswer, isRecordLookupQuestion } from '../src/answerComposer.js';
import { ResilientProvider } from '../src/modelProvider.js';
import { GroundedAnswerResult, parseOrIssues } from '../src/schemas.js';

const labResult = (overrides = {}) => ({
  test_name: 'Hemoglobin', value: '13.2', unit: 'g/dL', reference_range: '12.0-15.5', collection_date: '2026-01-05', abnormal_flag: 'normal', confidence: 0.95,
  citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.hgb.value', quote_or_value: '13.2' },
  ...overrides,
});
const guideline = (overrides = {}) => ({
  title: 'Synthetic primary-care diabetes follow-up', section: 'Follow-up review', version: '2026.1',
  snippet: 'Review documented glycemic values, medication history, adherence, symptoms, and missing monitoring evidence before clinician decisions.',
  sparse_score: 1, dense_score: 1, rerank_score: 1, matched_terms: ['diabetes'],
  citation: { source_type: 'guideline', source_id: 'guideline-diabetes-follow-up-1', page_or_section: 'Follow-up review', field_or_chunk_id: 'guideline-diabetes-follow-up-1', quote_or_value: 'Review documented glycemic values, medication history, adherence, symptoms, and missing monitoring evidence before clinician decisions.' },
  ...overrides,
});
const intakeLeaf = (overrides = {}) => ({ status: 'observed', value: 'Fatigue and thirst', confidence: 0.9, citation: { source_type: 'document', source_id: 'doc-2', page_or_section: 'page 1', field_or_chunk_id: 'chief_concern', quote_or_value: 'Reason for visit: Fatigue and thirst' }, ...overrides });
const intakeForm = (overrides = {}) => ({ demographics: { name: { status: 'not_found_on_form', value: null, confidence: 0, citation: null }, dob: { status: 'not_found_on_form', value: null, confidence: 0, citation: null } }, chief_concern: intakeLeaf(), current_medications: [], allergies: [], family_history: [], ...overrides });
const openemrFact = (overrides = {}) => ({ source_type: 'patient_record', patient_ref: 'p1', source_id: 'enc-1', field: 'encounter.reason', value: 'Diabetes follow-up', recorded_at: '2025-06-01', author: 'Dr X', citation: { source_type: 'openemr_record', source_id: 'enc-1', page_or_section: 'OpenEMR chart record', field_or_chunk_id: 'encounter.reason', quote_or_value: 'Diabetes follow-up' }, ...overrides });

function assertValidResult(result) {
  const validation = parseOrIssues(GroundedAnswerResult, result);
  assert.deepEqual(validation.issues, []);
  assert.ok(validation.ok, 'composer output must validate against GroundedAnswerResult');
}

test('deterministic composer: lab, intake, chart, and guideline facts all produce claims that verify (zero dropped)', async () => {
  const result = await composeGroundedAnswer({ labResults: [labResult()], intakeForm: intakeForm(), guidelineEvidence: [guideline()], patientFacts: [openemrFact()], question: 'What changed and what evidence supports it?' }, {});
  assertValidResult(result);
  assert.equal(result.composer, 'deterministic-fallback');
  assert.equal(result.unverified_dropped, 0);
  assert.equal(result.patient_facts.length, 3); // lab + intake leaf + chart fact
  assert.equal(result.guideline_evidence.length, 1);
  assert.ok(result.patient_facts.every((claim) => claim.kind === 'patient_fact'));
  assert.ok(result.guideline_evidence.every((claim) => claim.kind === 'guideline'));
});

test('deterministic composer: a test name with an embedded digit (A1C) is described generically but still verifies', async () => {
  const a1c = labResult({ test_name: 'Hemoglobin A1c', value: '8.2', unit: '%', reference_range: '4.0-5.6', abnormal_flag: 'high', citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.a1c.value', quote_or_value: '8.2' } });
  const result = await composeGroundedAnswer({ labResults: [a1c] }, {});
  assert.equal(result.unverified_dropped, 0);
  assert.equal(result.patient_facts.length, 1);
  assert.match(result.patient_facts[0].text, /8\.2 %/);
});

test('low-confidence facts are excluded from patient_facts and listed as needs_review, never as a claim', async () => {
  const lowConfidenceLab = labResult({ confidence: LOW_CONFIDENCE_THRESHOLD - 0.01 });
  const lowConfidenceLeaf = intakeLeaf({ confidence: 0.1 });
  const result = await composeGroundedAnswer({ labResults: [lowConfidenceLab], intakeForm: intakeForm({ chief_concern: lowConfidenceLeaf }) }, {});
  assert.equal(result.patient_facts.length, 0);
  assert.equal(result.needs_review.length, 2);
  assert.ok(result.needs_review.every((item) => item.reason === 'low_confidence'));
  const text = JSON.stringify(result.patient_facts);
  assert.ok(!text.includes('13.2'), 'the low-confidence lab value must never appear in a patient_fact claim');
});

test('a model that returns an invented, uncited claim has it dropped and counted, keeping the claims that do verify', async () => {
  const fakePrimary = {
    name: 'fake-model', model: 'fake-v1', async checkReady() { return true; },
    async generate() {
      return {
        text: JSON.stringify({ claims: [
          { kind: 'patient_fact', text: 'Hemoglobin was recorded at 13.2 g/dL on 2026-01-05, reference range 12.0-15.5, and is normal.', citations: [{ source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.hgb.value', quote_or_value: '13.2' }] },
          { kind: 'patient_fact', text: 'Potassium was recorded at 9.9 mmol/L on 2026-01-05.', citations: [{ source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.hgb.value', quote_or_value: '13.2' }] },
        ] }),
        inputTokens: 12, outputTokens: 12, estimatedCostUsd: 0.001,
      };
    },
  };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const result = await composeGroundedAnswer({ labResults: [labResult()] }, { provider });
  assertValidResult(result);
  assert.equal(result.composer, 'model');
  assert.equal(result.unverified_dropped, 1);
  assert.equal(result.patient_facts.length, 1);
  assert.match(result.patient_facts[0].text, /13\.2/);
  assert.ok(!JSON.stringify(result.patient_facts).includes('9.9'), 'the invented potassium value must never survive verification');
});

test('a model whose entire output fails verification falls back to the deterministic composer, not an empty answer', async () => {
  const fakePrimary = {
    name: 'vague-model', model: 'vague-v1', async checkReady() { return true; },
    async generate() {
      return { text: JSON.stringify({ claims: [{ kind: 'patient_fact', text: 'Everything looks fine overall, nothing concerning to report at this time.', citations: [{ source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.hgb.value', quote_or_value: '13.2' }] }] }), inputTokens: 5, outputTokens: 5, estimatedCostUsd: 0 };
    },
  };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const result = await composeGroundedAnswer({ labResults: [labResult()] }, { provider });
  assertValidResult(result);
  assert.equal(result.composer, 'deterministic-fallback');
  assert.equal(result.patient_facts.length, 1);
});

test('a model that throws or produces invalid JSON falls back to the deterministic composer', async () => {
  const throwingPrimary = { name: 'down-model', model: 'down-v1', async checkReady() { return true; }, async generate() { throw new Error('MODEL_TIMEOUT'); } };
  const throwing = await composeGroundedAnswer({ labResults: [labResult()] }, { provider: new ResilientProvider({ primary: throwingPrimary, fallback: new DeterministicAnswerComposer(), maxRetries: 0 }) });
  assert.equal(throwing.composer, 'deterministic-fallback');
  assert.equal(throwing.patient_facts.length, 1);

  const garbagePrimary = { name: 'garbage-model', model: 'garbage-v1', async checkReady() { return true; }, async generate() { return { text: 'not json at all', inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 }; } };
  const garbage = await composeGroundedAnswer({ labResults: [labResult()] }, { provider: new ResilientProvider({ primary: garbagePrimary, fallback: new DeterministicAnswerComposer(), maxRetries: 0 }) });
  assert.equal(garbage.composer, 'deterministic-fallback');
  assert.equal(garbage.patient_facts.length, 1);
});

test('no provider configured composes deterministically', async () => {
  const result = await composeGroundedAnswer({ labResults: [labResult()] });
  assert.equal(result.composer, 'deterministic-fallback');
  assert.equal(result.patient_facts.length, 1);
});

test('with no guideline evidence given (an off-topic or record-lookup question), there are never guideline claims -- deterministic path', async () => {
  const result = await composeGroundedAnswer({ labResults: [labResult()], guidelineEvidence: [] }, {});
  assert.deepEqual(result.guideline_evidence, []);
});

test('with no guideline evidence given, a model cannot manufacture a guideline claim either -- it has nothing to cite', async () => {
  const fakePrimary = {
    name: 'hallucinating-model', model: 'h-v1', async checkReady() { return true; },
    async generate() {
      return { text: JSON.stringify({ claims: [{ kind: 'guideline', text: 'Per Some Invented Guideline: "take this medication twice daily for best results."', citations: [{ source_type: 'guideline', source_id: 'not-a-real-guideline', page_or_section: 'Nowhere', field_or_chunk_id: 'not-a-real-guideline', quote_or_value: 'take this medication twice daily for best results.' }] }] }), inputTokens: 5, outputTokens: 5, estimatedCostUsd: 0 };
    },
  };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const result = await composeGroundedAnswer({ labResults: [labResult()], guidelineEvidence: [] }, { provider });
  assert.deepEqual(result.guideline_evidence, []);
  assert.ok(result.unverified_dropped >= 1 || result.composer === 'deterministic-fallback');
});

test('isRecordLookupQuestion is exported and agrees with the supervisor\'s rule', () => {
  assert.equal(isRecordLookupQuestion('What was the hemoglobin value?'), true);
  assert.equal(isRecordLookupQuestion('What changed since the last visit?'), false);
});
