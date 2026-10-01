import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { judgeAnswerClaims, numbersIn } from '../src/gateClaimJudge.js';

const labCitation = { source_type: 'document', source_id: 'src-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.hgb.value', quote_or_value: 'Hemoglobin value: 11.9' };
const guidelineCitation = { source_type: 'guideline', source_id: 'g-1', page_or_section: 'Ranges', field_or_chunk_id: 'g-1', quote_or_value: 'Diabetes: 6.5% or above' };
const sources = [
  { citation: labCitation, kind: 'patient_fact', texts: [labCitation.quote_or_value, '11.9', '12.0-16.0', '2026-09-21', 'g/dL'] },
  { citation: guidelineCitation, kind: 'guideline', texts: [guidelineCitation.quote_or_value, 'May 15, 2024'] },
];
const claim = (text, citations, kind = 'patient_fact') => ({ kind, text, citations });

test('the judge imports nothing from the production answer path', () => {
  const source = fs.readFileSync(new URL('../src/gateClaimJudge.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m, 'gateClaimJudge.js must stay import-free so a verifier defect cannot blind it');
  assert.doesNotMatch(source, /require\(|import\(/);
});

test('the gate calls the independent judge on every answer it checks', () => {
  const gate = fs.readFileSync(new URL('../src/w2RegressionGate.js', import.meta.url), 'utf8');
  assert.match(gate, /issues\.push\(\.\.\.judgeAnswerClaims\(allClaims, judgeSources\)\)/);
});

test('claims that cite what the run produced, with numbers from the cited item, pass', () => {
  const claims = [
    claim('Hemoglobin 11.9 g/dL on 2026-09-21 (reference 12.0-16.0), flagged abnormal.', [labCitation]),
    claim('Per the guideline (May 15, 2024): "Diabetes: 6.5% or above"', [guidelineCitation], 'guideline'),
  ];
  assert.deepEqual(judgeAnswerClaims(claims, sources), []);
});

test('an uncited claim fails', () => {
  assert.deepEqual(judgeAnswerClaims([claim('Potassium 9.9 mmol/L.', [])], sources), ['answer_claim[0]:uncited']);
});

test('a citation the run never produced fails, and so does a rewritten quote', () => {
  assert.deepEqual(judgeAnswerClaims([claim('Hemoglobin 11.9.', [{ ...labCitation, source_id: 'src-other' }])], sources), ['answer_claim[0]:cites_source_not_in_run', 'answer_claim[0]:number_not_in_cited_source']);
  assert.deepEqual(judgeAnswerClaims([claim('Hemoglobin 11.9.', [{ ...labCitation, quote_or_value: 'Hemoglobin value: 9.9' }])], sources), ['answer_claim[0]:quote_differs_from_run_citation', 'answer_claim[0]:number_not_in_cited_source']);
});

test('a number the cited item does not hold fails, even next to the right value', () => {
  assert.deepEqual(judgeAnswerClaims([claim('Hemoglobin 11.9 g/dL (reference 9.1-16.0).', [labCitation])], sources), ['answer_claim[0]:number_not_in_cited_source']);
});

test('a patient fact citing a guideline (or the reverse) fails', () => {
  assert.deepEqual(judgeAnswerClaims([claim('Diabetes: 6.5% or above', [guidelineCitation])], sources), ['answer_claim[0]:kind_patient_fact_cites_guideline_source']);
  assert.deepEqual(judgeAnswerClaims([claim('Hemoglobin 11.9.', [labCitation], 'guideline')], sources), ['answer_claim[0]:kind_guideline_cites_patient_fact_source']);
});

test('numbers compare by value, so 12.0 and 12 are the same number', () => {
  assert.deepEqual(numbersIn('12.0-16.0 on 2026-09-21'), ['12', '16', '2026', '9', '21']);
});
