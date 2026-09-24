import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyClaims } from '../src/verifier.js';
import { Citation, GuidelineEvidence, IntakeForm, LabResult } from '../src/schemas.js';

// Synthetic allowed values in the exact W2 typed shapes (validated below).
const citation = (source_type, source_id, field_or_chunk_id, quote_or_value, page_or_section = 'page 1') => ({ source_type, source_id, page_or_section, field_or_chunk_id, quote_or_value });
const labResult = (test_name, value, unit, reference_range, abnormal_flag, field) => ({
  test_name, value, unit, reference_range, collection_date: '2026-09-20', abnormal_flag, confidence: 0.94,
  citation: citation('document', 'doc-lab-1', field, `${test_name} ${value} ${unit}`),
});
const intakeLeaf = (value, field, page = 'page 2') => ({ status: 'observed', value, confidence: 0.9, citation: citation('document', 'doc-intake-1', field, value, page) });

const hemoglobin = labResult('Hemoglobin', '13.2', 'g/dL', '12.0-15.5 g/dL', 'normal', 'lab.hemoglobin');
const potassium = labResult('Potassium', '4.1', 'mmol/L', '3.5-5.1 mmol/L', 'normal', 'lab.k');
const hba1c = labResult('HbA1c', '7.2', '%', '4.0-5.6 %', 'high', 'lab.hba1c');
// Golden-truth test-name spelling (test/fixtures/golden/truth/lab-a.json):
// raw test_name "A1C", exercised through `LAB_NAME_ALIASES`.
const a1c = labResult('A1C', '6.1', '%', 'under 5.7', 'abnormal', 'lab.a1c');
const metformin = intakeLeaf('Metformin 500 mg daily', 'current_medications.0');
const metformin1000 = intakeLeaf('Metformin 1000 mg daily', 'current_medications.1');
const chiefConcern = intakeLeaf('Fatigue for two weeks', 'chief_concern');
const allergy = intakeLeaf('Penicillin (hives)', 'allergies.0');
const age = citation('openemr_record', 'patient-001', 'demographics.age', '42', 'demographics');
const metforminStarted = { field: 'medication.metformin.status', value: 'started', source_ref: 'med-900', recorded_at: '2026-09-01T10:00:00Z' };
const metforminStartedCitation = citation('openemr_record', 'med-900', 'medication.metformin.status', 'started', 'medication list');
const adaSnippet = 'Metformin is the preferred initial pharmacologic agent for the treatment of type 2 diabetes when not contraindicated.';
const ada = {
  title: 'ADA Standards of Care', section: 'Pharmacologic therapy', version: '2026', url: 'https://diabetesjournals.org/care/issue/49/Supplement_1', publisher: 'ADA', snippet: adaSnippet,
  sparse_score: 1, dense_score: 1, rerank_score: 1, matched_terms: [], degraded: null,
  citation: citation('guideline', 'ada-2026', 'ada-2026-chunk-9', adaSnippet, 'Pharmacologic therapy'),
};
// A real-corpus-shaped chunk whose version is a date (S5 corpus), so the
// deterministic composer's "Per <title> guideline, section <section>
// (<version>)" attribution must still verify.
const cdcSnippet = 'The A1C test is a simple blood test that measures your average blood sugar levels over the past 3 months.';
const cdc = {
  title: 'A1C Test for Diabetes and Prediabetes', section: 'What Is the A1C Test?', version: 'May 15, 2024', url: 'https://www.cdc.gov/diabetes/diabetes-testing/prediabetes-a1c-test.html', publisher: 'CDC', snippet: cdcSnippet,
  sparse_score: 1, dense_score: 1, rerank_score: 1, matched_terms: [], degraded: null,
  citation: citation('guideline', 'cdc-a1c-test-definition', 'cdc-a1c-test-definition', cdcSnippet, 'What Is the A1C Test?'),
};
const allowedValues = [hemoglobin, potassium, hba1c, a1c, metformin, metformin1000, chiefConcern, allergy, age, metforminStarted, ada, cdc];

const fact = (text, ...citations) => ({ kind: 'patient_fact', text, citations });
const guideline = (text, ...citations) => ({ kind: 'guideline', text, citations });
const framing = (text) => ({ kind: 'framing', text, citations: [] });
const judge = (claim, contextTerms = []) => verifyClaims({ claims: [claim], allowedValues, contextTerms });

test('probe allowed values are real W2 schema shapes', () => {
  for (const lab of [hemoglobin, potassium, hba1c]) assert.equal(LabResult.safeParse(lab).success, true);
  const form = {
    demographics: { name: intakeLeaf('Test Patient', 'demographics.name', 'page 1'), dob: intakeLeaf('1980-04-12', 'demographics.dob', 'page 1') },
    chief_concern: chiefConcern, current_medications: [metformin, metformin1000], allergies: [allergy], family_history: [],
  };
  assert.equal(IntakeForm.safeParse(form).success, true);
  assert.equal(GuidelineEvidence.safeParse(ada).success, true);
  assert.equal(Citation.safeParse(age).success, true);
});

// Each row: [probe, claim, expected reason codes (all must be present)].
// Every probe here is a false claim the W2 composer could emit; each must fail.
const FAILING_PROBES = [
  ['uncited Synthroid', fact('Patient is on Synthroid 100 mcg daily.'), ['UNCITED_CLAIM']],
  ['uncited Eliquis', fact('Patient takes Eliquis 5 mg twice daily.'), ['UNCITED_CLAIM']],
  ['uncited tacrolimus', fact('Tacrolimus level is 8.1.'), ['UNCITED_CLAIM']],
  ['uncited Jardiance', fact('Patient is on Jardiance.'), ['UNCITED_CLAIM']],
  ['no known allergies with an allergy on file', fact('No known allergies.', allergy.citation), ['NEGATION_UNSUPPORTED']],
  ['HbA1c has improved', fact('HbA1c has improved.', hba1c.citation), ['UNSUPPORTED_TOKEN', 'CITED_VALUE_MISSING']],
  ['critically low when flag is normal', fact('Hemoglobin 13.2 g/dL is critically low.', hemoglobin.citation), ['UNSUPPORTED_INTERPRETATION']],
  ['twice daily when record says daily', fact('Metformin 500 mg twice daily.', metformin.citation), ['CITED_VALUE_MISSING', 'UNSUPPORTED_TOKEN']],
  ['spelled-out dose', fact('Metformin ten milligrams daily.', metformin.citation), ['CITED_VALUE_MISSING', 'UNSUPPORTED_TOKEN']],
  ['six months when record says two weeks', fact('Fatigue for six months.', chiefConcern.citation), ['CITED_VALUE_MISSING', 'UNSUPPORTED_TOKEN']],
  ['1000 years old citing metformin 1000 mg', fact('The patient is 1000 years old.', metformin1000.citation), ['CITED_VALUE_MISSING', 'UNSUPPORTED_TOKEN']],
  ['42 ER visits citing age 42', fact('42 ER visits.', age), ['UNSUPPORTED_TOKEN']],
  ['chest pain citing the fatigue field', fact('Chest pain for two weeks.', chiefConcern.citation), ['CITED_VALUE_MISSING', 'UNSUPPORTED_TOKEN']],
  ['hemoglobin claim citing lab.k', fact('Hemoglobin 4.1 mmol/L.', potassium.citation), ['UNSUPPORTED_TOKEN']],
  // The A1C alias may only be used when the claim actually cites the A1C
  // result -- naming it while citing a different lab (here, plain
  // "Hemoglobin") must still fail (LAB_NAME_ALIASES is scoped per fact).
  ['A1C named while citing the plain hemoglobin result', fact('A1C 13.2 g/dL.', hemoglobin.citation), ['UNSUPPORTED_TOKEN']],
  ['HbA1c named while citing the plain hemoglobin result', fact('HbA1c 13.2 g/dL.', hemoglobin.citation), ['UNSUPPORTED_TOKEN']],
  ['Hemoglobin named while citing the A1C result', fact('Hemoglobin 6.1 %.', a1c.citation), ['UNSUPPORTED_TOKEN']],
  ['fake source_id', fact('Hemoglobin 13.2 g/dL.', { ...hemoglobin.citation, source_id: 'doc-fake' }), ['CITATION_NOT_ALLOWED']],
  ['field-less citation', fact('Hemoglobin 13.2 g/dL.', { ...hemoglobin.citation, field_or_chunk_id: undefined }), ['CITATION_INVALID']],
  ['quote-only match with wrong ids', fact('Hemoglobin 13.2 g/dL.', { ...hemoglobin.citation, source_id: 'doc-other', field_or_chunk_id: 'lab.other' }), ['CITATION_NOT_ALLOWED']],
  ['right ids, altered quote', fact('Hemoglobin 13.2 g/dL.', { ...hemoglobin.citation, quote_or_value: 'Hemoglobin 9.1 g/dL' }), ['CITATION_QUOTE_MISMATCH']],
  ['wrong collection date', fact('Hemoglobin 13.2 g/dL, collected on 2026-09-21.', hemoglobin.citation), ['UNANCHORED_DATE']],
  ['guideline quote with a date that is not its version', guideline(`Per A1C Test for Diabetes and Prediabetes guideline, section What Is the A1C Test? (June 1, 2020): "${cdcSnippet}"`, cdc.citation), ['UNANCHORED_DATE']],
  ['guideline paraphrase not in the chunk', guideline('Per ADA metformin is first-line for every patient.', ada.citation), ['GUIDELINE_QUOTE_MISSING']],
  ['patient fact citing a guideline', fact('The patient takes metformin.', ada.citation), ['GUIDELINE_CITED_FOR_PATIENT_FACT']],
  ['guideline claim citing a patient value', guideline('Metformin 500 mg daily.', metformin.citation), ['NON_GUIDELINE_CITATION']],
  ['imperative dose instruction', fact('Take Metformin 500 mg daily.', metformin.citation), ['DIRECTIVE_LANGUAGE']],
  ['second-person instruction', fact('You should keep Metformin 500 mg daily.', metformin.citation), ['DIRECTIVE_LANGUAGE']],
  ['recommendation to act', fact('Consider prescribing Metformin 500 mg daily.', metformin.citation), ['DIRECTIVE_LANGUAGE']],
  ['framing with clinical content', framing('Hemoglobin results are available.'), ['FRAMING_HAS_CLINICAL_CONTENT']],
  ['framing smuggling a symptom', framing('The patient reports chest pain.'), ['UNSUPPORTED_TOKEN']],
  ['unknown claim kind', { kind: 'opinion', text: 'Fine.', citations: [] }, ['INVALID_CLAIM_KIND']],
];

for (const [name, claim, codes] of FAILING_PROBES) {
  test(`claims mode rejects: ${name}`, () => {
    const result = judge(claim);
    assert.equal(result.status, 'failed');
    assert.equal(result.verdicts[0].status, 'unanchored');
    for (const code of codes) assert.ok(result.verdicts[0].reasons.includes(code), `${name}: expected ${code}, got ${result.verdicts[0].reasons}`);
  });
}

const WITHHELD = ['medication.metformin.dose', 'conflict:medication.metformin.dose'];
for (const leak of ['The metformin dose was one thousand milligrams.', 'The metformin dose was at the higher dose.', 'Metformin was discontinued.']) {
  test(`framing may name a withheld drug but not state its value: ${leak}`, () => {
    const result = judge(framing(leak), WITHHELD);
    assert.equal(result.status, 'failed');
    assert.ok(result.verdicts[0].reasons.includes('CONTEXT_TERM_WITH_VALUE'), String(result.verdicts[0].reasons));
  });
}

// True claims the composer must be able to make; over-rejection would force
// every grounded answer onto the fallback.
const PASSING_PROBES = [
  ['trailing zero', fact('Hemoglobin 13.20 g/dL.', hemoglobin.citation)],
  ['no unit spacing', fact('Hemoglobin 13.2g/dL.', hemoglobin.citation)],
  ['typed collection date', fact('Hemoglobin 13.2 g/dL, collected on 2026-09-20.', hemoglobin.citation)],
  ['normal flag supports within the normal range', fact('Hemoglobin 13.2 g/dL is within the normal range of 12.0-15.5 g/dL.', hemoglobin.citation)],
  ['high flag supports high', fact('HbA1c 7.2 % is high.', hba1c.citation)],
  // LAB_NAME_ALIASES: the raw golden-truth test name is "A1C"; a claim may
  // spell it any of the aliased ways as long as it cites that same result.
  ['A1C named exactly as its raw test_name, citing its own result', fact('A1C 6.1 % is abnormal.', a1c.citation)],
  ['A1C named as the combined Hemoglobin A1C alias, citing its own result', fact('Hemoglobin A1C 6.1 % on 2026-09-20, reference under 5.7, is abnormal.', a1c.citation)],
  ['A1C named as glycated hemoglobin, citing its own result', fact('Glycated hemoglobin 6.1 % is abnormal.', a1c.citation)],
  ['Hb alias for the plain hemoglobin result', fact('Hb 13.2 g/dL.', hemoglobin.citation)],
  ['typed intake medication leaf', fact('The intake form lists Metformin 500 mg daily.', metformin.citation)],
  ['typed intake chief concern leaf', fact('The chief concern is fatigue for two weeks.', chiefConcern.citation)],
  ['typed intake allergy leaf', fact('Allergy on file: Penicillin (hives).', allergy.citation)],
  ['citation-shaped record value', fact('The patient age is 42.', age)],
  ['descriptive past tense is not a directive', fact('Metformin was started.', metforminStartedCitation)],
  ['two cited values in one claim', fact('Metformin 500 mg daily and HbA1c 7.2 % are documented.', metformin.citation, hba1c.citation)],
  ['verbatim guideline quote with a date-format version', guideline(`Per A1C Test for Diabetes and Prediabetes guideline, section What Is the A1C Test? (May 15, 2024): "${cdcSnippet}"`, cdc.citation)],
  ['verbatim guideline quote with attribution', guideline('ADA recommends: metformin is the preferred initial pharmacologic agent for the treatment of type 2 diabetes.', ada.citation)],
  ['withheld drug with qualification phrasing only', framing('The metformin dose is withheld because records conflict.')],
];

for (const [name, claim] of PASSING_PROBES) {
  test(`claims mode accepts: ${name}`, () => {
    const result = judge(claim, WITHHELD);
    assert.equal(result.status, 'passed', `${name}: ${JSON.stringify(result.verdicts)}`);
  });
}

test('claims mode verdicts are per claim, carry codes not text, and empty input fails', () => {
  const result = verifyClaims({ allowedValues, claims: [framing('Here is what the record shows.'), fact('Hemoglobin 13.2 g/dL.', hemoglobin.citation), fact('Patient is on Jardiance.')] });
  assert.deepEqual(result.verdicts.map((verdict) => [verdict.index, verdict.claim_kind, verdict.status]), [[0, 'framing', 'no_clinical_assertion'], [1, 'patient_fact', 'anchored'], [2, 'patient_fact', 'unanchored']]);
  assert.deepEqual(result.issues.sort(), ['UNANCHORED_CLAIM', 'UNCITED_CLAIM']);
  assert.doesNotMatch(JSON.stringify(result), /13\.2|Hemoglobin|Jardiance/);
  assert.deepEqual(verifyClaims({ allowedValues, claims: [] }).issues, ['NO_CLAIMS']);
});

test('text mode directive check targets instructions, not descriptions', () => {
  const described = verifyClaims({ text: 'Metformin was started. Hypertension was diagnosed. The current treatment is lisinopril.', allowedValues: ['metformin started', 'hypertension diagnosed', 'lisinopril'] });
  assert.equal(described.verdicts.some((verdict) => verdict.reasons.includes('DIRECTIVE_LANGUAGE')), false);
  for (const instruction of ['Start metformin.', 'You should increase lisinopril.', 'Consider prescribing lisinopril.', 'It is recommended to stop metformin.']) {
    assert.ok(verifyClaims({ text: instruction, allowedValues: ['metformin', 'lisinopril'] }).issues.includes('UNSAFE_CLINICAL_ACTION_LANGUAGE'), instruction);
  }
});
