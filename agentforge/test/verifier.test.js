import test from 'node:test';
import assert from 'node:assert/strict';
import { verify, verifyClaims, verifyGeneratedText } from '../src/verifier.js';
import { DeterministicProvider, ResilientProvider } from '../src/modelProvider.js';

// Synthetic briefing claims in the shape PreVisitPreparation produces.
const claim = (field, value, sourceRef, recordedAt) => ({
  field, value, patient_ref: 'fixture-patient-001', source_ref: sourceRef,
  evidence: [{ patient_ref: 'fixture-patient-001', source_ref: sourceRef, record_type: field.split('.')[0], recorded_at: recordedAt, excerpt: value }],
});
const lisinoprilOnly = [claim('medication.lisinopril.dose', '5 mg daily', 'med-000', '2026-08-13T09:05:00Z')];
const briefingClaims = [
  claim('problem.hypertension.status', 'active', 'problem-001', '2026-09-10T09:00:00Z'),
  claim('medication.lisinopril.dose', '5 mg daily', 'med-000', '2026-08-13T09:05:00Z'),
  claim('medication.lisinopril.dose', '10 mg daily', 'med-001', '2026-09-10T09:05:00Z'),
  claim('encounter.reason', 'blood-pressure follow-up', 'enc-001', '2026-09-10T09:10:00Z'),
];

// Guards: the W1 review probe. One real value used to pass the whole text
// (`.some`), so invented warfarin and penicillin-anaphylaxis sentences shipped.
test('fabricated-warfarin probe fails: every sentence must be anchored, not just one', () => {
  const result = verifyGeneratedText({ text: 'Lisinopril dose is 5 mg daily. Patient also takes warfarin 10 mg daily and has a documented penicillin anaphylaxis.', claims: lisinoprilOnly });
  assert.equal(result.status, 'failed');
  assert.ok(result.issues.includes('UNANCHORED_CLAIM'));
  assert.deepEqual(result.unanchored_sentences.map((item) => item.sentence_index), [1]);
  assert.ok(result.unanchored_sentences[0].reasons.includes('UNANCHORED_TERM'));
  assert.ok(result.unanchored_sentences[0].reasons.includes('UNANCHORED_QUANTITY'));
  assert.equal(result.evidence_grounding, 'failed');
});

// Guards: over-rejection. A correct multi-sentence answer must still pass,
// or every live answer falls back to the template.
test('a fully anchored multi-sentence answer passes', () => {
  const text = 'Hypertension is documented as active. Lisinopril changed from 5 mg daily on 2026-08-13 to 10 mg daily on September 10, 2026. The visit reason is a blood-pressure follow-up.';
  const result = verifyGeneratedText({ text, claims: briefingClaims });
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.deepEqual(result.unanchored_sentences, []);
});

// Guards: invented values next to real drug names.
test('an invented number, an invented date, or a number borrowed from another fact fails', () => {
  assert.ok(verifyGeneratedText({ text: 'Hypertension is active. Lisinopril is recorded at 20 mg daily.', claims: briefingClaims }).issues.includes('UNANCHORED_CLAIM'));
  assert.ok(verifyGeneratedText({ text: 'Lisinopril 10 mg daily was recorded on 2026-09-11.', claims: briefingClaims }).unanchored_sentences[0].reasons.includes('UNANCHORED_DATE'));
  // "10 mg" is real for lisinopril, not for hypertension's neighbor metformin.
  const borrowed = verifyGeneratedText({ text: 'Lisinopril is 5 mg daily. Metformin is 10 mg daily.', claims: [...briefingClaims, claim('medication.metformin.dose', '500 mg daily', 'med-201', '2026-09-12T11:00:00Z')] });
  assert.deepEqual(borrowed.unanchored_sentences, [{ sentence_index: 1, reasons: ['UNANCHORED_QUANTITY'] }]);
});

// Guards: the service's own caveats. A withheld drug may be named (for example
// "metformin dose conflict"), but its withheld value may never be stated.
test('withheld fields and qualification reasons anchor names but never numbers', () => {
  const context = { withheldFields: ['medication.metformin.dose'], qualificationReasons: ['conflict:medication.metformin.dose'] };
  assert.equal(verifyGeneratedText({ text: 'Hypertension is active. The metformin dose has conflicting records.', claims: briefingClaims, ...context }).status, 'passed');
  assert.ok(verifyGeneratedText({ text: 'Hypertension is active. Metformin is 1000 mg daily.', claims: briefingClaims, ...context }).issues.includes('UNANCHORED_CLAIM'));
  assert.ok(verifyGeneratedText({ text: 'Hypertension is active. The metformin dose has conflicting records.', claims: briefingClaims }).issues.includes('UNANCHORED_CLAIM'));
});

// Guards: the fallback path. Rejected model text must be replaced by the
// deterministic template, and that template must itself verify.
test('an unanchored model answer falls back to the deterministic template', async () => {
  const primary = { name: 'fabricating-model', model: 'probe', async checkReady() { return true; }, async generate() { return { text: 'Lisinopril dose is 5 mg daily. Patient also takes warfarin 10 mg daily and has a documented penicillin anaphylaxis.' }; } };
  const provider = new ResilientProvider({ primary, fallback: new DeterministicProvider(), maxRetries: 0 });
  const result = await provider.generate({ patient: { display_name: 'Synthetic Patient' }, claims: lisinoprilOnly, qualification: { required: false, reasons: [] } }, { validate: (candidate) => verifyGeneratedText({ text: candidate.text, claims: lisinoprilOnly }) });
  assert.equal(result.provider_fallback, true);
  assert.equal(result.provider_error_code, 'MODEL_OUTPUT_REJECTED');
  assert.doesNotMatch(result.text, /warfarin|anaphylaxis/i);
  assert.match(result.text, /Lisinopril is recorded at 5 mg daily/);
});

// Guards: the W2 composer contract. Each claim is judged alone, against only
// the values its citations resolve to.
test('verifyClaims returns per-claim verdicts against cited allowed values', () => {
  const allowedValues = [
    { source_type: 'document', source_id: 'doc-lab-a', page_or_section: 'page 1', field_or_chunk_id: 'lab.potassium', quote_or_value: 'Potassium 5.9 mmol/L' },
    { source_type: 'document', source_id: 'doc-lab-a', page_or_section: 'page 1', field_or_chunk_id: 'lab.hba1c', quote_or_value: 'HbA1c 7.2 %' },
    ...lisinoprilOnly,
  ];
  const potassiumCitation = allowedValues[0];
  const result = verifyClaims({ allowedValues, claims: [
    { text: 'Potassium was 5.9 mmol/L.', citations: [potassiumCitation] },
    { text: 'HbA1c was 7.2 %.', citations: [potassiumCitation] },
    { text: 'Lisinopril is 5 mg daily.' },
    { text: 'Potassium was 5.9 mmol/L.', citations: [{ ...potassiumCitation, source_id: 'doc-other', field_or_chunk_id: 'lab.other', quote_or_value: 'Potassium 6.1 mmol/L' }] },
    { text: 'The document was reviewed.', citations: [] },
  ] });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.verdicts.map((verdict) => verdict.status), ['anchored', 'unanchored', 'unanchored', 'unanchored', 'no_clinical_assertion']);
  assert.ok(result.verdicts[1].reasons.includes('UNANCHORED_TERM'), 'citing the potassium value cannot anchor an HbA1c claim');
  assert.ok(result.verdicts[2].reasons.includes('UNCITED_CLAIM'));
  assert.ok(result.verdicts[3].reasons.includes('CITATION_NOT_ALLOWED'));
  assert.deepEqual(result.issues.sort(), ['CITATION_NOT_ALLOWED', 'UNANCHORED_CLAIM', 'UNCITED_CLAIM']);
  assert.doesNotMatch(JSON.stringify(result), /5\.9|Potassium|Lisinopril/, 'verdicts carry codes, not text');
});

test('verifyClaims text mode gives one verdict per sentence and keeps the directive check', () => {
  const result = verifyClaims({ text: 'Lisinopril is 5 mg daily. Also take warfarin 10 mg daily. Follow up soon.', allowedValues: lisinoprilOnly });
  assert.deepEqual(result.verdicts.map((verdict) => [verdict.index, verdict.status]), [[0, 'anchored'], [1, 'unanchored'], [2, 'no_clinical_assertion']]);
  assert.ok(verifyClaims({ text: 'Increase lisinopril to 5 mg daily.', allowedValues: lisinoprilOnly }).issues.includes('UNSAFE_CLINICAL_ACTION_LANGUAGE'));
  assert.equal(verifyClaims({ text: 'Lisinopril is 5 mg daily.', allowedValues: ['lisinopril 5 mg daily'] }).status, 'passed');
});

test('complete verification fails when any coverage group is unavailable', () => {
  const result = verify({
    patientRef: 'fixture-patient-001',
    claims: [],
    coverage: [{ group: 'notes', status: 'failed', records: 0, attempts: 3, error_class: 'upstream_unavailable' }],
    qualification: { required: true, reasons: ['notes:failed'] },
    operations: [{ type: 'read', operation: 'retrieve_openemr_read' }],
    disposition: 'complete',
  });
  assert.equal(result.status, 'failed');
  assert.ok(result.issues.includes('COMPLETE_WITH_UNAVAILABLE_COVERAGE'));
});

test('verification rejects read operations outside the canonical allowlist', () => {
  const result = verify({
    patientRef: 'fixture-patient-001',
    coverage: [],
    qualification: { required: false, reasons: [] },
    operations: [{ type: 'read', operation: 'write_chart' }],
    disposition: 'complete',
  });
  assert.equal(result.status, 'failed');
  assert.ok(result.issues.includes('WRITE_CAPABLE_BEHAVIOR'));
});

test('successful empty coverage is distinct from unavailable coverage', () => {
  const result = verify({
    patientRef: 'fixture-patient-001',
    coverage: [
      { group: 'identity', status: 'success', records: 1, attempts: 1, error_class: null },
      { group: 'encounters', status: 'success', records: 1, attempts: 1, error_class: null },
      { group: 'problems', status: 'success', records: 1, attempts: 1, error_class: null },
      { group: 'medications', status: 'success', records: 1, attempts: 1, error_class: null },
      { group: 'notes', status: 'empty', records: 0, attempts: 1, error_class: null },
    ],
    qualification: { required: false, reasons: [] },
    operations: [{ type: 'read', operation: 'retrieve_openemr_read' }],
    disposition: 'complete',
  });
  assert.equal(result.status, 'passed');
});

test('complete verification fails when canonical coverage groups are missing', () => {
  const result = verify({
    patientRef: 'fixture-patient-001',
    coverage: [{ group: 'identity', status: 'success', records: 1, attempts: 1, error_class: null }],
    qualification: { required: false, reasons: [] },
    operations: [{ type: 'read', operation: 'retrieve_openemr_read' }],
    disposition: 'complete',
  });
  assert.equal(result.status, 'failed');
  assert.ok(result.issues.includes('COMPLETE_COVERAGE_GROUP_MISSING'));
});
