import test from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicAnswerComposer, LOW_CONFIDENCE_THRESHOLD, composeGroundedAnswer, isRecordLookupQuestion, labelForCitation } from '../src/answerComposer.js';
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

test('deterministic composer: a test name with an embedded digit (A1C) is named exactly, not genericized, and still verifies', async () => {
  const a1c = labResult({ test_name: 'A1C', value: '6.1', unit: '%', reference_range: 'under 5.7', collection_date: '2026-09-20', abnormal_flag: 'abnormal', citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.a1c.value', quote_or_value: 'A1C value: 6.1' } });
  const result = await composeGroundedAnswer({ labResults: [a1c] }, {});
  assert.equal(result.unverified_dropped, 0);
  assert.equal(result.patient_facts.length, 1);
  assert.match(result.patient_facts[0].text, /^A1C 6\.1 % on 2026-09-20 \(reference under 5\.7\), flagged abnormal\.$/);
});

test('deterministic composer: a Hemoglobin A1c test name is also named exactly (the combined-name golden fixture spelling)', async () => {
  const a1c = labResult({ test_name: 'Hemoglobin A1c', value: '8.2', unit: '%', reference_range: '4.0-5.6', abnormal_flag: 'high', citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.a1c.value', quote_or_value: '8.2' } });
  const result = await composeGroundedAnswer({ labResults: [a1c] }, {});
  assert.equal(result.unverified_dropped, 0);
  assert.equal(result.patient_facts.length, 1);
  assert.match(result.patient_facts[0].text, /^Hemoglobin A1c 8\.2 %/);
});

test('deterministic composer: intake claims are the form\'s own labeled line, not wrapped in a duplicate label', async () => {
  const chiefConcern = intakeLeaf({ citation: { source_type: 'document', source_id: 'doc-2', page_or_section: 'page 1', field_or_chunk_id: 'chief_concern', quote_or_value: 'Chief concern: Fatigue for two weeks' } });
  const medication = intakeLeaf({ value: 'Metformin 500 mg daily', citation: { source_type: 'document', source_id: 'doc-2', page_or_section: 'page 1', field_or_chunk_id: 'medications', quote_or_value: 'Current medications: Metformin 500 mg daily' } });
  const result = await composeGroundedAnswer({ intakeForm: intakeForm({ chief_concern: chiefConcern, current_medications: [medication] }) }, {});
  assert.equal(result.unverified_dropped, 0);
  assert.equal(result.patient_facts.length, 2);
  assert.ok(result.patient_facts.some((claim) => claim.text === 'Chief concern: Fatigue for two weeks.'));
  assert.ok(result.patient_facts.some((claim) => claim.text === 'Current medications: Metformin 500 mg daily.'));
  // Never a doubled label like "records chief concern as Chief concern: ...".
  assert.ok(!result.patient_facts.some((claim) => /records .* as /.test(claim.text)));
});

test('demographics (name, DOB, phone) never appear as a patient_fact claim, even though the intake form has them observed', async () => {
  const demographics = {
    name: { status: 'observed', value: 'Test Patient One', confidence: 0.99, citation: { source_type: 'document', source_id: 'doc-2', page_or_section: 'page 1', field_or_chunk_id: 'patient.name', quote_or_value: 'Patient name: Test Patient One' } },
    dob: { status: 'observed', value: '1980-04-12', confidence: 0.99, citation: { source_type: 'document', source_id: 'doc-2', page_or_section: 'page 1', field_or_chunk_id: 'patient.date_of_birth', quote_or_value: 'Date of birth: 1980-04-12' } },
    phone: { status: 'observed', value: '555-0100', confidence: 0.99, citation: { source_type: 'document', source_id: 'doc-2', page_or_section: 'page 1', field_or_chunk_id: 'patient.phone', quote_or_value: 'Phone: 555-0100' } },
  };
  const result = await composeGroundedAnswer({ intakeForm: intakeForm({ demographics }) }, {});
  assert.equal(result.patient_facts.length, 1); // only the default chief_concern leaf
  assert.ok(!JSON.stringify(result.patient_facts).match(/Test Patient One|1980-04-12|555-0100/), 'demographics must never reach a patient_fact claim');
  assert.equal(result.needs_review.length, 0, 'excluded demographics are not low-confidence -- they are simply never sent, not flagged for review');
});

test('model path: claims that name each lab test exactly as its own test_name verify with zero drops', async () => {
  const a1c = labResult({ test_name: 'Hemoglobin A1C', value: '6.1', unit: '%', reference_range: 'under 5.7', collection_date: '2026-09-20', abnormal_flag: 'abnormal', citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.a1c.value', quote_or_value: '6.1' } });
  const fakePrimary = {
    name: 'naming-model', model: 'naming-v1', async checkReady() { return true; },
    async generate(args) {
      const ref = labelForCitation(args.factLabels, a1c.citation);
      return { text: JSON.stringify({ claims: [{ kind: 'patient_fact', text: 'Hemoglobin A1C 6.1 % on 2026-09-20 (reference under 5.7), flagged abnormal.', refs: [ref] }] }), inputTokens: 5, outputTokens: 5, estimatedCostUsd: 0 };
    },
  };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const result = await composeGroundedAnswer({ labResults: [a1c] }, { provider });
  assert.equal(result.composer, 'model');
  assert.equal(result.unverified_dropped, 0);
  assert.equal(result.patient_facts.length, 1);
  assert.match(result.patient_facts[0].text, /Hemoglobin A1C/);
});

test('model path: a claim naming a different test than the one it cites is dropped, not shipped', async () => {
  const hemoglobinResult = labResult({ test_name: 'Hemoglobin', value: '13.2', unit: 'g/dL', reference_range: '12.0-16.0', abnormal_flag: 'normal', citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.hgb.value', quote_or_value: '13.2' } });
  const fakePrimary = {
    name: 'wrong-name-model', model: 'wrong-v1', async checkReady() { return true; },
    async generate(args) {
      // Cites the Hemoglobin result but names it "A1C" -- must fail structural
      // binding (LAB_NAME_ALIASES is scoped per-fact, not a blanket allowlist).
      const ref = labelForCitation(args.factLabels, hemoglobinResult.citation);
      return { text: JSON.stringify({ claims: [{ kind: 'patient_fact', text: 'A1C 13.2 g/dL on 2026-01-05, reference 12.0-16.0, flagged normal.', refs: [ref] }] }), inputTokens: 5, outputTokens: 5, estimatedCostUsd: 0 };
    },
  };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const result = await composeGroundedAnswer({ labResults: [hemoglobinResult] }, { provider });
  assert.equal(result.unverified_dropped, 1);
  assert.ok(!JSON.stringify(result.patient_facts).includes('A1C'), 'the wrongly-named claim must never survive');
  // The deterministic top-up/fallback still answers the fact under its real name.
  assert.ok(JSON.stringify(result.patient_facts).includes('Hemoglobin'));
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
    async generate(args) {
      const ref = labelForCitation(args.factLabels, { source_id: 'doc-1', field_or_chunk_id: 'lab.hgb.value' });
      return {
        text: JSON.stringify({ claims: [
          { kind: 'patient_fact', text: 'Hemoglobin was recorded at 13.2 g/dL on 2026-01-05, reference range 12.0-15.5, and is normal.', refs: [ref] },
          // Same real label, but an invented value the fact never carries --
          // must fail on content, not on citation resolution.
          { kind: 'patient_fact', text: 'Potassium was recorded at 9.9 mmol/L on 2026-01-05.', refs: [ref] },
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
    async generate(args) {
      const ref = labelForCitation(args.factLabels, { source_id: 'doc-1', field_or_chunk_id: 'lab.hgb.value' });
      return { text: JSON.stringify({ claims: [{ kind: 'patient_fact', text: 'Everything looks fine overall, nothing concerning to report at this time.', refs: [ref] }] }), inputTokens: 5, outputTokens: 5, estimatedCostUsd: 0 };
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
      // No guideline evidence was given at all, so there is no real G-label
      // to cite -- the model can only invent one, which must not resolve.
      return { text: JSON.stringify({ claims: [{ kind: 'guideline', text: 'Per Some Invented Guideline: "take this medication twice daily for best results."', refs: ['G1'] }] }), inputTokens: 5, outputTokens: 5, estimatedCostUsd: 0 };
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

// F1 review fix: maxTokens threaded to the real provider, and deterministic
// top-up for facts/evidence a partially-successful model answer missed.
test('composeGroundedAnswer passes a maxTokens of at least 2000 to the real provider (not the 300-token briefing default)', async () => {
  let capturedMaxTokens = null;
  const fakePrimary = { name: 'fake-model', model: 'fake-v1', async checkReady() { return true; }, async generate({ maxTokens }) { capturedMaxTokens = maxTokens; return { text: JSON.stringify({ claims: [] }), inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 }; } };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  await composeGroundedAnswer({ labResults: [labResult()] }, { provider });
  assert.ok(capturedMaxTokens >= 2000, `expected maxTokens >= 2000, got ${capturedMaxTokens}`);
});

test('a model that verifies only one of several available facts gets the missing ones topped up deterministically, labeled model+deterministic-topup', async () => {
  const secondLab = labResult({ test_name: 'Potassium', value: '5.9', unit: 'mmol/L', reference_range: '3.5-5.1', abnormal_flag: 'high', citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.k.value', quote_or_value: '5.9' } });
  const legitText = 'Hemoglobin was recorded at 13.2 g/dL on 2026-01-05, reference range 12.0-15.5, and is normal.';
  const fakePrimary = {
    name: 'thin-model', model: 'thin-v1', async checkReady() { return true; },
    async generate(args) {
      const ref = labelForCitation(args.factLabels, labResult().citation);
      return { text: JSON.stringify({ claims: [{ kind: 'patient_fact', text: legitText, refs: [ref] }] }), inputTokens: 5, outputTokens: 5, estimatedCostUsd: 0 };
    },
  };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const result = await composeGroundedAnswer({ labResults: [labResult(), secondLab], guidelineEvidence: [guideline()] }, { provider });
  assert.equal(result.composer, 'model+deterministic-topup');
  assert.equal(result.patient_facts.length, 2);
  assert.equal(result.guideline_evidence.length, 1);
  assert.ok(result.patient_facts.some((claim) => claim.text === legitText));
  assert.ok(result.patient_facts.some((claim) => /Potassium/.test(claim.text)));
});

test('a model that already covers every fact and guideline is not relabeled as topped up', async () => {
  const fakePrimary = {
    name: 'complete-model', model: 'complete-v1', async checkReady() { return true; },
    async generate({ verifiedLabResults, guidelineEvidence: ge, factLabels, guidelineLabels }) {
      const claims = [
        { kind: 'patient_fact', text: 'Hemoglobin was recorded at 13.2 g/dL on 2026-01-05, reference range 12.0-15.5, and is normal.', refs: [labelForCitation(factLabels, verifiedLabResults[0].citation)] },
        { kind: 'guideline', text: `Per Synthetic primary-care diabetes follow-up guideline, section Follow-up review (2026.1): "${ge[0].snippet}"`, refs: [labelForCitation(guidelineLabels, ge[0].citation)] },
      ];
      return { text: JSON.stringify({ claims }), inputTokens: 5, outputTokens: 5, estimatedCostUsd: 0 };
    },
  };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const result = await composeGroundedAnswer({ labResults: [labResult()], guidelineEvidence: [guideline()] }, { provider });
  assert.equal(result.composer, 'model');
  assert.equal(result.patient_facts.length, 1);
  assert.equal(result.guideline_evidence.length, 1);
});

// F2 review fix: dropped count and rejection reason survive the fallback.
test('model_rejected_reason is all_claims_unverified and the drop count is carried forward when every model claim fails verification', async () => {
  // Sodium was never a fact given to the composer, so there is no real
  // F-label for it -- the model can only invent one, which must not resolve.
  const fakePrimary = { name: 'bad-model', model: 'bad-v1', async checkReady() { return true; }, async generate() { return { text: JSON.stringify({ claims: [{ kind: 'patient_fact', text: 'Sodium was recorded at 140 mmol/L.', refs: ['F99'] }] }), inputTokens: 5, outputTokens: 5, estimatedCostUsd: 0 }; } };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const result = await composeGroundedAnswer({ labResults: [labResult()] }, { provider });
  assert.equal(result.composer, 'deterministic-fallback');
  assert.equal(result.model_rejected_reason, 'all_claims_unverified');
  assert.equal(result.unverified_dropped, 1);
});

test('model_rejected_reason is invalid_json when the model never produces schema-valid JSON', async () => {
  const fakePrimary = { name: 'garbage-model', model: 'garbage-v1', async checkReady() { return true; }, async generate() { return { text: 'not json', inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 }; } };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer(), maxRetries: 0 });
  const result = await composeGroundedAnswer({ labResults: [labResult()] }, { provider });
  assert.equal(result.composer, 'deterministic-fallback');
  assert.equal(result.model_rejected_reason, 'invalid_json');
});

test('model_rejected_reason is provider_error when the model throws (e.g. a timeout)', async () => {
  const fakePrimary = { name: 'down-model', model: 'down-v1', async checkReady() { return true; }, async generate() { throw new Error('MODEL_TIMEOUT'); } };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer(), maxRetries: 0 });
  const result = await composeGroundedAnswer({ labResults: [labResult()] }, { provider });
  assert.equal(result.composer, 'deterministic-fallback');
  assert.equal(result.model_rejected_reason, 'provider_error');
});

test('model_rejected_reason is absent when no model is configured at all', async () => {
  const result = await composeGroundedAnswer({ labResults: [labResult()] }, {});
  assert.equal(result.composer, 'deterministic-fallback');
  assert.equal('model_rejected_reason' in result, false);
});

test('GroundedAnswerResult accepts every model_rejected_reason and the topup composer label', () => {
  for (const reason of ['all_claims_unverified', 'invalid_json', 'provider_error', 'deadline']) {
    const candidate = { composer: 'deterministic-fallback', model_rejected_reason: reason, patient_facts: [], guideline_evidence: [], needs_review: [], unverified_dropped: 1, model_claims_proposed: 0, model_claims_verified: 0 };
    assert.equal(parseOrIssues(GroundedAnswerResult, candidate).ok, true, reason);
  }
  assert.equal(parseOrIssues(GroundedAnswerResult, { composer: 'model+deterministic-topup', patient_facts: [], guideline_evidence: [], needs_review: [], unverified_dropped: 0, model_claims_proposed: 3, model_claims_verified: 2 }).ok, true);
});

// F4 review fix: exactly one model-usage entry per composed answer.
test('composeGroundedAnswer records exactly one model-usage entry on the trace, for every composer path', async () => {
  const traceStub = () => { const usage = []; return { usage, recordModelUsage: (entry) => usage.push(entry) }; };

  const detTrace = traceStub();
  await composeGroundedAnswer({ labResults: [labResult()] }, { trace: detTrace });
  assert.equal(detTrace.usage.length, 1);
  assert.equal(detTrace.usage[0].stage, 'answer');
  assert.equal(detTrace.usage[0].provider, 'deterministic-answer-composer');

  const modelTrace = traceStub();
  const fakePrimary = { name: 'fake-model', model: 'fake-v1', async checkReady() { return true; }, async generate(args) { const ref = labelForCitation(args.factLabels, labResult().citation); return { text: JSON.stringify({ claims: [{ kind: 'patient_fact', text: 'Hemoglobin was recorded at 13.2 g/dL on 2026-01-05, reference range 12.0-15.5, and is normal.', refs: [ref] }] }), inputTokens: 10, outputTokens: 20, estimatedCostUsd: 0.002 }; } };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  await composeGroundedAnswer({ labResults: [labResult()] }, { provider, trace: modelTrace });
  assert.equal(modelTrace.usage.length, 1);
  assert.equal(modelTrace.usage[0].provider, 'fake-model');
  assert.equal(modelTrace.usage[0].inputTokens, 10);

  const fallbackTrace = traceStub();
  const throwingPrimary = { name: 'down-model', model: 'down-v1', async checkReady() { return true; }, async generate() { throw new Error('boom'); } };
  await composeGroundedAnswer({ labResults: [labResult()] }, { provider: new ResilientProvider({ primary: throwingPrimary, fallback: new DeterministicAnswerComposer(), maxRetries: 0 }), trace: fallbackTrace });
  assert.equal(fallbackTrace.usage.length, 1);
});

// F7 review fix: an already-deterministic provider is used directly, with no
// wasted retries or spurious errors (DeterministicProvider.generate expects
// briefing-shaped {patient, ...} args and would throw on the composer's).
test('an effectively-deterministic provider (bare DeterministicProvider, or a ResilientProvider wrapping one) is used directly, no retries', async () => {
  const { DeterministicProvider } = await import('../src/modelProvider.js');
  const trace = { retries: [], recordRetry(entry) { this.retries.push(entry); } };

  const bare = await composeGroundedAnswer({ labResults: [] }, { provider: new DeterministicProvider(), trace });
  assert.equal(bare.composer, 'deterministic-fallback');
  assert.equal(trace.retries.length, 0);

  const wrapped = new ResilientProvider({ primary: new DeterministicProvider(), fallback: new DeterministicAnswerComposer() });
  assert.equal(wrapped.primaryHealthy, null);
  const trace2 = { retries: [], recordRetry(entry) { this.retries.push(entry); } };
  const result = await composeGroundedAnswer({ labResults: [labResult()] }, { provider: wrapped, trace: trace2 });
  assert.equal(result.composer, 'deterministic-fallback');
  assert.equal(trace2.retries.length, 0);
  assert.equal(wrapped.primaryHealthy, null); // never touched -- no attempt was ever made against it
});

// F6 review fix: a deadline that has already passed skips the real model
// entirely and records why.
test('a signal that is already aborted skips the real model and reports model_rejected_reason: deadline', async () => {
  const fakePrimary = { name: 'fake-model', model: 'fake-v1', async checkReady() { return true; }, async generate() { throw new Error('should never be called'); } };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const controller = new AbortController();
  controller.abort();
  const result = await composeGroundedAnswer({ labResults: [labResult()] }, { provider, signal: controller.signal });
  assert.equal(result.composer, 'deterministic-fallback');
  assert.equal(result.model_rejected_reason, 'deadline');
  assert.equal(result.patient_facts.length, 1);
});

// 2026-09-24 refs-based rewrite: the model's own output cites facts/guideline
// chunks by short label only, never by echoing a full citation object (the
// same fix already applied to the listwise reranker's candidate numbers).
test('the prompt lists facts/guideline chunks under short labels and asks the model to cite by "refs", never by echoing a full citation object', async () => {
  const a1c = labResult({ test_name: 'A1C', value: '6.1', unit: '%', reference_range: 'under 5.7', collection_date: '2026-09-20', abnormal_flag: 'abnormal', citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.a1c.value', quote_or_value: 'A1C value: 6.1' } });
  let capturedPrompt = null;
  const fakePrimary = { name: 'fake-model', model: 'fake-v1', async checkReady() { return true; }, async generate(args) { capturedPrompt = args.prompt; return { text: JSON.stringify({ claims: [] }), inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 }; } };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  await composeGroundedAnswer({ labResults: [a1c], guidelineEvidence: [guideline()] }, { provider });
  assert.ok(capturedPrompt, 'the prompt must be built and passed to the provider');
  assert.match(capturedPrompt, /^F1 \[lab\] A1C 6\.1 % on 2026-09-20 \(reference under 5\.7\), flagged abnormal$/m, 'the lab fact must be listed under its own short label, as a compact line');
  assert.match(capturedPrompt, /^G1 \[/m, 'the guideline chunk must be listed under its own short label');
  assert.match(capturedPrompt, /"refs":\["F1"\]/, 'the requested output shape must cite by label ("refs"), not by a citation object');
  assert.ok(!/"citations"\s*:/.test(capturedPrompt), 'the prompt must never ask the model to return a "citations" key at all');
  assert.ok(!/"source_type"/.test(capturedPrompt), 'the prompt must never ask the model to echo citation fields such as source_type');
});

test('a realistic ref-based model response for lab-a facts is materialized into claims carrying full 5-key citations that verify', async () => {
  const a1c = labResult({ test_name: 'A1C', value: '6.1', unit: '%', reference_range: 'under 5.7', collection_date: '2026-09-20', abnormal_flag: 'abnormal', citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.a1c.value', quote_or_value: 'A1C value: 6.1' } });
  const fakePrimary = {
    name: 'lab-a-model', model: 'lab-a-v1', async checkReady() { return true; },
    async generate(args) {
      assert.equal(args.factLabels.length, 1);
      const [{ label }] = args.factLabels;
      return { text: JSON.stringify({ claims: [{ kind: 'patient_fact', text: 'A1C 6.1 % on 2026-09-20 (reference under 5.7), flagged abnormal.', refs: [label] }] }), inputTokens: 20, outputTokens: 20, estimatedCostUsd: 0 };
    },
  };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const result = await composeGroundedAnswer({ labResults: [a1c] }, { provider });
  assertValidResult(result);
  assert.equal(result.composer, 'model');
  assert.equal(result.unverified_dropped, 0);
  assert.equal(result.patient_facts.length, 1);
  const [claim] = result.patient_facts;
  assert.equal(claim.citations.length, 1);
  assert.deepEqual(Object.keys(claim.citations[0]).sort(), ['field_or_chunk_id', 'page_or_section', 'quote_or_value', 'source_id', 'source_type']);
  assert.deepEqual(claim.citations[0], a1c.citation, 'the materialized citation must be the exact allowed citation object, never reconstructed from the model\'s own text');
});

test('a claim whose ref does not name any known label is dropped: it ends up with no citations, fails UNCITED_CLAIM, and never survives', async () => {
  const MARKER = 'phantom-ref-claim-marker';
  const fakePrimary = {
    name: 'phantom-ref-model', model: 'phantom-v1', async checkReady() { return true; },
    async generate() {
      return { text: JSON.stringify({ claims: [{ kind: 'patient_fact', text: `Hemoglobin was recorded at 13.2 g/dL on 2026-01-05 (${MARKER}).`, refs: ['F999'] }] }), inputTokens: 5, outputTokens: 5, estimatedCostUsd: 0 };
    },
  };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const result = await composeGroundedAnswer({ labResults: [labResult()] }, { provider });
  assert.equal(result.model_rejected_reason, 'all_claims_unverified');
  assert.equal(result.unverified_dropped, 1);
  assert.ok(!JSON.stringify(result.patient_facts).includes(MARKER), 'a claim whose only ref never resolves must never survive');
  // The fact itself is still answered -- just via the deterministic fallback under its real citation.
  assert.equal(result.patient_facts.length, 1);
});

// Guards against a regression where an unknown ref is silently mapped to
// *some* real citation (e.g. "just use the first fact") instead of being
// dropped. With two facts present, an unresolved ref whose claim text
// happens to match the *first* fact's own values would wrongly verify if the
// unknown ref fell back to that first fact's citation -- exactly the kind of
// "cite garbage, get whatever's first" laundering `materializeClaims` must
// never allow. A ref must resolve to exactly the label it names, or not at
// all.
// Task 1 (KEY_METRICS "model grounding rate"): model_claims_proposed/
// model_claims_verified count the real model's own raw claims only, captured
// once before any later fallback or F1 top-up can replace or extend them.
test('model_claims_proposed/verified: a fake model with 3 claims, 1 unverifiable, verifies 2 -- and the topped-up 3rd fact is not counted as the model\'s own', async () => {
  const labA = labResult();
  const labB = labResult({ test_name: 'Potassium', value: '5.9', unit: 'mmol/L', reference_range: '3.5-5.1', abnormal_flag: 'high', citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.k.value', quote_or_value: '5.9' } });
  const labC = labResult({ test_name: 'Sodium', value: '140', unit: 'mmol/L', reference_range: '135-145', abnormal_flag: 'normal', citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.na.value', quote_or_value: '140' } });
  const fakePrimary = {
    name: 'three-claim-model', model: 'three-v1', async checkReady() { return true; },
    async generate(args) {
      const refA = labelForCitation(args.factLabels, labA.citation);
      const refB = labelForCitation(args.factLabels, labB.citation);
      const refC = labelForCitation(args.factLabels, labC.citation);
      return {
        text: JSON.stringify({ claims: [
          { kind: 'patient_fact', text: 'Hemoglobin 13.2 g/dL on 2026-01-05 (reference 12.0-15.5), flagged normal.', refs: [refA] },
          { kind: 'patient_fact', text: 'Potassium 5.9 mmol/L on 2026-01-05 (reference 3.5-5.1), flagged high.', refs: [refB] },
          // Cites the real Sodium label but an invented value -- fails
          // content verification, not citation resolution.
          { kind: 'patient_fact', text: 'Sodium was recorded at 999 mmol/L on 2026-01-05.', refs: [refC] },
        ] }),
        inputTokens: 20, outputTokens: 20, estimatedCostUsd: 0.001,
      };
    },
  };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const result = await composeGroundedAnswer({ labResults: [labA, labB, labC] }, { provider });
  assertValidResult(result);
  assert.equal(result.model_claims_proposed, 3);
  assert.equal(result.model_claims_verified, 2);
  // The Sodium fact still reaches the answer -- via the deterministic F1
  // top-up, not the model -- so patient_facts holds all 3 facts and the
  // composer label reflects the top-up, but the model's own counted claims
  // stay frozen at 3/2, unaffected by the extra topped-up claim.
  assert.equal(result.composer, 'model+deterministic-topup');
  assert.equal(result.patient_facts.length, 3);
});

test('model_claims_proposed/verified are 0/0 on the deterministic-only path (no provider configured at all)', async () => {
  const result = await composeGroundedAnswer({ labResults: [labResult()] }, {});
  assert.equal(result.composer, 'deterministic-fallback');
  assert.equal(result.model_claims_proposed, 0);
  assert.equal(result.model_claims_verified, 0);
});

test('model_claims_proposed/verified are 0/0 when the per-request deadline had already passed before the call', async () => {
  const fakePrimary = { name: 'fake-model', model: 'fake-v1', async checkReady() { return true; }, async generate() { throw new Error('should never be called'); } };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const controller = new AbortController();
  controller.abort();
  const result = await composeGroundedAnswer({ labResults: [labResult()] }, { provider, signal: controller.signal });
  assert.equal(result.model_rejected_reason, 'deadline');
  assert.equal(result.model_claims_proposed, 0);
  assert.equal(result.model_claims_verified, 0);
});

test('model_claims_proposed/verified are 0/0 when the model throws (provider_error) -- no parseable output ever reached us', async () => {
  const throwingPrimary = { name: 'down-model', model: 'down-v1', async checkReady() { return true; }, async generate() { throw new Error('MODEL_TIMEOUT'); } };
  const result = await composeGroundedAnswer({ labResults: [labResult()] }, { provider: new ResilientProvider({ primary: throwingPrimary, fallback: new DeterministicAnswerComposer(), maxRetries: 0 }) });
  assert.equal(result.model_rejected_reason, 'provider_error');
  assert.equal(result.model_claims_proposed, 0);
  assert.equal(result.model_claims_verified, 0);
});

test('model_claims_proposed/verified are 0/0 when the model never produces schema-valid JSON -- ResilientProvider\'s own internal fallback ran, not the model', async () => {
  const garbagePrimary = { name: 'garbage-model', model: 'garbage-v1', async checkReady() { return true; }, async generate() { return { text: 'not json at all', inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 }; } };
  const result = await composeGroundedAnswer({ labResults: [labResult()] }, { provider: new ResilientProvider({ primary: garbagePrimary, fallback: new DeterministicAnswerComposer(), maxRetries: 0 }) });
  assert.equal(result.model_rejected_reason, 'invalid_json');
  assert.equal(result.model_claims_proposed, 0);
  assert.equal(result.model_claims_verified, 0);
});

test('model_claims_proposed/verified reflect a model whose schema-valid JSON has zero claims that verify (all_claims_unverified): proposed > 0, verified 0', async () => {
  const fakePrimary = { name: 'bad-model', model: 'bad-v1', async checkReady() { return true; }, async generate() { return { text: JSON.stringify({ claims: [{ kind: 'patient_fact', text: 'Sodium was recorded at 140 mmol/L.', refs: ['F99'] }] }), inputTokens: 5, outputTokens: 5, estimatedCostUsd: 0 }; } };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const result = await composeGroundedAnswer({ labResults: [labResult()] }, { provider });
  assert.equal(result.model_rejected_reason, 'all_claims_unverified');
  assert.equal(result.model_claims_proposed, 1);
  assert.equal(result.model_claims_verified, 0);
});

test('composeGroundedAnswer records model_claims_proposed/verified on the trace answer-stage entry (counts only, no PHI)', async () => {
  const traceStub = () => { const usage = []; return { usage, recordModelUsage: (entry) => usage.push(entry) }; };
  const trace = traceStub();
  const fakePrimary = { name: 'fake-model', model: 'fake-v1', async checkReady() { return true; }, async generate(args) { const ref = labelForCitation(args.factLabels, labResult().citation); return { text: JSON.stringify({ claims: [{ kind: 'patient_fact', text: 'Hemoglobin was recorded at 13.2 g/dL on 2026-01-05, reference range 12.0-15.5, and is normal.', refs: [ref] }] }), inputTokens: 10, outputTokens: 20, estimatedCostUsd: 0.002 }; } };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  await composeGroundedAnswer({ labResults: [labResult()] }, { provider, trace });
  assert.equal(trace.usage.length, 1);
  assert.equal(trace.usage[0].model_claims_proposed, 1);
  assert.equal(trace.usage[0].model_claims_verified, 1);
});

test('an unresolved ref never silently borrows another fact\'s citation, even one whose values happen to match the claim text', async () => {
  const first = labResult({ test_name: 'Hemoglobin', value: '13.2', unit: 'g/dL', reference_range: '12.0-15.5', collection_date: '2026-01-05', abnormal_flag: 'normal', citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.hgb.value', quote_or_value: '13.2' } });
  const second = labResult({ test_name: 'Potassium', value: '5.9', unit: 'mmol/L', reference_range: '3.5-5.1', collection_date: '2026-01-05', abnormal_flag: 'high', citation: { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.k.value', quote_or_value: '5.9' } });
  const fakePrimary = {
    name: 'phantom-ref-model-2', model: 'phantom-v2', async checkReady() { return true; },
    async generate() {
      // "F999" names no real label at all (only F1/F2 exist here) -- it must
      // never resolve to any citation, including the first fact's.
      return { text: JSON.stringify({ claims: [{ kind: 'patient_fact', text: 'Hemoglobin 13.2 g/dL on 2026-01-05 (reference 12.0-15.5), flagged normal.', refs: ['F999'] }] }), inputTokens: 5, outputTokens: 5, estimatedCostUsd: 0 };
    },
  };
  const provider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const result = await composeGroundedAnswer({ labResults: [first, second] }, { provider });
  // If an unresolved ref were ever mapped to "whatever fact is first" instead
  // of being dropped, this claim would wrongly verify (its text matches
  // `first`'s real values) and be counted as genuine model output rather
  // than an unverified drop -- exactly the failure mode this guards against.
  assert.equal(result.unverified_dropped, 1, 'a claim whose ref never resolves to a real label must be counted as dropped, never silently attributed to whatever fact happens to be listed first');
  assert.notEqual(result.composer, 'model', 'the model produced zero genuinely-cited claims of its own; it must never be reported as having produced fully-verified model output');
});
