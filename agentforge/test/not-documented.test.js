import test from 'node:test';
import assert from 'node:assert/strict';
import { askedMeasurementConcepts, asksAboutMore, findNotDocumented, onlyNotDocumented } from '../src/notDocumented.js';
import { composeGroundedAnswer } from '../src/answerComposer.js';
import { GroundedAnswerResult, parseOrIssues } from '../src/schemas.js';

const chart = (field, value) => ({ field, value, source_type: 'synthetic_chart_fixture' });
// fixture-patient-001's chart as the fixture adapter returns it: blood pressure is
// the visit's topic, but no record holds a reading.
const PATIENT_001 = [chart('problem.hypertension.status', 'active'), chart('medication.lisinopril.dose', '10 mg daily'), chart('encounter.reason', 'blood-pressure follow-up'), chart('note.plan_follow_through', 'home blood-pressure log reviewed at return visit')];
const citation = (field, quote) => ({ source_type: 'document', source_id: 'src-nd', page_or_section: 'page 1', field_or_chunk_id: field, quote_or_value: quote });
const lab = (test_name, value, unit, field) => ({ test_name, value, unit, reference_range: 'x', collection_date: '2026-09-20', abnormal_flag: 'normal', confidence: 0.95, citation: citation(field, value) });

test('askedMeasurementConcepts: value questions name a concept; guideline and non-measurement questions do not', () => {
  const ids = (question) => askedMeasurementConcepts(question).map((concept) => concept.id);
  assert.deepEqual(ids('What was the blood pressure?'), ['blood_pressure']);
  assert.deepEqual(ids('latest BP reading'), ['blood_pressure']);
  assert.deepEqual(ids('What was the potassium and the A1C?'), ['potassium', 'a1c']);
  assert.deepEqual(ids('what was the hemoglobin value?'), ['hemoglobin']);
  assert.deepEqual(ids('What is the target blood pressure?'), [], 'a guideline figure, not a recorded value');
  assert.deepEqual(ids('A1C blood sugar diabetes diagnosis threshold'), [], 'the gate retrieval query is not a value question');
  assert.deepEqual(ids('What is the lisinopril dose?'), []);
  assert.deepEqual(ids('What was the glycated hemoglobin?'), ['a1c'], 'glycated hemoglobin is A1C, not hemoglobin');
  assert.deepEqual(ids(''), []);
});

test('findNotDocumented: a word match is not a reading; a field, lab or quoted reading is', () => {
  const missing = findNotDocumented({ question: 'What was the blood pressure?', facts: PATIENT_001 });
  assert.deepEqual(missing.asked, ['blood_pressure']);
  assert.deepEqual(missing.notDocumented.map((item) => item.concept), ['blood_pressure']);
  assert.deepEqual(missing.notDocumented[0].sources_checked, ['synthetic_chart_fixture']);
  // No source read holds vitals: the entry says so instead of claiming absence.
  assert.equal(missing.notDocumented[0].status, 'not_retrieved');
  assert.match(missing.notDocumented[0].text, /not available from the sources read \(vital signs are not retrieved\)/);
  const read = findNotDocumented({ question: 'What was the blood pressure?', facts: PATIENT_001, readGroups: ['vitals'] });
  assert.equal(read.notDocumented[0].status, 'not_documented');
  assert.ok(onlyNotDocumented(missing));

  for (const facts of [[...PATIENT_001, chart('vitals.bps', '128')], [...PATIENT_001, chart('vitals.bpd', '82')], [...PATIENT_001, chart('vitals.bp', '128/82')], [...PATIENT_001, chart('note.body', 'Seated BP 128/82 today')], [...PATIENT_001, chart('vital.blood_pressure.systolic', '128')]]) {
    assert.deepEqual(findNotDocumented({ question: 'What was the blood pressure?', facts }).notDocumented, [], JSON.stringify(facts.at(-1)));
  }
  // A withheld BP field is recorded but not shown: never "not documented".
  assert.deepEqual(findNotDocumented({ question: 'What was the blood pressure?', facts: PATIENT_001, withheldFields: ['vitals.bp'] }).notDocumented, []);
});

test('findNotDocumented: lab questions are checked against the typed results, at any confidence', () => {
  const labs = [lab('Hemoglobin', '13.2', 'g/dL', 'lab.hgb.value'), { ...lab('A1C', '6.1', '%', 'lab.a1c.value'), confidence: 0.5 }];
  assert.deepEqual(findNotDocumented({ question: 'what was the hemoglobin value?', labResults: labs }).notDocumented, []);
  assert.deepEqual(findNotDocumented({ question: 'What was the A1C?', labResults: labs }).notDocumented, [], 'a low-confidence A1C is documented (it needs review), not absent');
  const mixed = findNotDocumented({ question: 'What were the hemoglobin and potassium results?', labResults: labs });
  assert.deepEqual(mixed.notDocumented.map((item) => item.concept), ['potassium']);
  assert.equal(onlyNotDocumented(mixed), false, 'hemoglobin is documented, so the question still gets an answer');
});

test('onlyNotDocumented: a question that also names another topic keeps the rest of the answer', () => {
  const both = findNotDocumented({ question: 'documented medication and blood pressure', facts: PATIENT_001 });
  assert.deepEqual(both.notDocumented.map((item) => item.concept), ['blood_pressure']);
  assert.equal(asksAboutMore('documented medication and blood pressure'), true);
  assert.equal(onlyNotDocumented(both), false);
  for (const question of ['What was the blood pressure?', 'latest BP reading', 'What is the most recent recorded blood pressure value?']) assert.equal(asksAboutMore(question), false, question);
});

test('scan answer: a question asking only for an undocumented value gets a "not documented" answer and no unrelated claims', async () => {
  const labs = [lab('Hemoglobin', '13.2', 'g/dL', 'lab.hgb.value'), lab('A1C', '6.1', '%', 'lab.a1c.value')];
  const patientFacts = PATIENT_001.map((fact) => ({ field: fact.field, value: fact.value, citation: { source_type: 'synthetic_chart_fixture', source_id: `rec-${fact.field}`, page_or_section: 'Synthetic chart fixture', field_or_chunk_id: fact.field, quote_or_value: fact.value } }));
  const guidelineEvidence = [{ title: 'Hypertension in Adults: Screening', section: 'Recommendation Summary (Grade A)', version: '2021', snippet: 'The USPSTF recommends screening for hypertension in adults 18 years or older with office blood pressure measurement.', citation: { source_type: 'guideline', source_id: 'uspstf-hypertension-screening-recommendation', page_or_section: 'Recommendation Summary (Grade A)', field_or_chunk_id: 'uspstf-hypertension-screening-recommendation', quote_or_value: 'The USPSTF recommends screening for hypertension in adults 18 years or older with office blood pressure measurement.' } }];
  let modelCalled = false;
  const provider = { name: 'spy-model', model: 'spy', generate: async () => { modelCalled = true; throw new Error('must not be called'); } };

  const answer = await composeGroundedAnswer({ labResults: labs, patientFacts, guidelineEvidence, question: 'What was the blood pressure?' }, { provider });
  assert.ok(parseOrIssues(GroundedAnswerResult, answer).ok);
  assert.equal(answer.composer, 'not-documented');
  assert.deepEqual(answer.patient_facts, []);
  assert.deepEqual(answer.guideline_evidence, []);
  assert.deepEqual(answer.not_documented.map((item) => item.concept), ['blood_pressure']);
  assert.deepEqual(answer.not_documented[0].sources_checked, ['document', 'synthetic_chart_fixture']);
  assert.equal(answer.not_documented[0].status, 'not_retrieved', 'a lab report and the chart read hold no vitals');
  // A lab missing from a lab report is not documented in the report that was read.
  const k = await composeGroundedAnswer({ labResults: labs, patientFacts, question: 'What was the potassium?' });
  assert.deepEqual(k.not_documented.map((item) => [item.concept, item.status]), [['potassium', 'not_documented']]);
  assert.equal(modelCalled, false);

  // A documented value question is answered as before, with no not_documented entry.
  const hgb = await composeGroundedAnswer({ labResults: labs, patientFacts, question: 'what was the hemoglobin value?' });
  assert.equal(hgb.composer, 'deterministic-fallback');
  assert.deepEqual(hgb.not_documented, []);
  assert.ok(hgb.patient_facts.length > 0);
});
