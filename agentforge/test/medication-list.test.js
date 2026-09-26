import test from 'node:test';
import assert from 'node:assert/strict';
import { MedicationItem, MedicationList, parseOrIssues } from '../src/schemas.js';
import { SCAN_DOCUMENT_TYPES, allowedScanField, requiredScanFields, validateScanExtraction } from '../src/scanFormContracts.js';
import { validateScanExtractionTypedOutput } from '../src/contracts.js';

const citation = { source_type: 'document', source_id: 'src-1', page_or_section: 'page 1', field_or_chunk_id: 'medication.1.name', quote_or_value: 'Medication 1: Metformin 500 mg twice daily oral', bounding_box: [10, 20, 300, 40], coordinate_space: 'raster_pixels_200dpi' };
const observed = (value) => ({ status: 'observed', value, confidence: 0.93 });
const notFound = { status: 'not_found_on_form', value: null, confidence: 0 };
const cited = (value) => ({ status: 'observed', value, confidence: 0.93, citation: { ...citation, field_or_chunk_id: 'medlist.list_date', quote_or_value: `List date: ${value}` } });
const citedNotFound = { status: 'not_found_on_form', value: null, confidence: 0, citation: null };

const validItem = { name: observed('Metformin'), dose: observed('500'), unit: observed('mg'), frequency: observed('twice daily'), route: observed('oral'), citation };
const validList = { list_date: cited('2026-09-22'), prescriber_or_source: citedNotFound, patient: { name: cited('Test Patient One'), dob: cited('1980-04-12') }, medications: [validItem] };

test('MedicationList contract: a complete list parses, and every required key is required', () => {
  assert.equal(parseOrIssues(MedicationList, validList).ok, true);
  for (const key of ['list_date', 'prescriber_or_source', 'patient', 'medications']) {
    const { [key]: _dropped, ...without } = validList;
    assert.equal(parseOrIssues(MedicationList, without).ok, false, `MedicationList must require ${key}`);
  }
  for (const key of ['name', 'dob']) {
    const { [key]: _dropped, ...without } = validList.patient;
    assert.equal(parseOrIssues(MedicationList, { ...validList, patient: without }).ok, false, `MedicationList.patient must require ${key}`);
  }
  assert.equal(parseOrIssues(MedicationList, { ...validList, extra: true }).ok, false, 'strict: unknown keys are rejected');
  // An empty list is still a typed list: "no rows read" is not "section omitted".
  assert.equal(parseOrIssues(MedicationList, { ...validList, medications: [] }).ok, true);
});

test('MedicationItem contract: name, dose, unit, frequency, route and citation are each required', () => {
  assert.equal(parseOrIssues(MedicationItem, validItem).ok, true);
  for (const key of ['name', 'dose', 'unit', 'frequency', 'route', 'citation']) {
    const { [key]: _dropped, ...without } = validItem;
    assert.equal(parseOrIssues(MedicationItem, without).ok, false, `MedicationItem must require ${key}`);
  }
});

test('MedicationItem citation uses the exact five-key shape (each key required, old names rejected)', () => {
  for (const key of ['source_type', 'source_id', 'page_or_section', 'field_or_chunk_id', 'quote_or_value']) {
    const { [key]: _dropped, ...without } = citation;
    assert.equal(parseOrIssues(MedicationItem, { ...validItem, citation: without }).ok, false, `citation must require ${key}`);
  }
  assert.equal(parseOrIssues(MedicationItem, { ...validItem, citation: { ...citation, source_document_id: 'src-1' } }).ok, false);
  assert.equal(parseOrIssues(MedicationItem, { ...validItem, citation: { ...citation, bounding_box: [1, 2, 3] } }).ok, false);
});

test('MedicationItem: a missing part is explicit not_found_on_form, never an invented value; the name must be observed', () => {
  assert.equal(parseOrIssues(MedicationItem, { ...validItem, route: notFound }).ok, true);
  assert.equal(parseOrIssues(MedicationItem, { ...validItem, route: { status: 'not_found_on_form', value: 'oral', confidence: 0 } }).ok, false);
  assert.equal(parseOrIssues(MedicationItem, { ...validItem, route: { status: 'observed', value: '', confidence: 0.9 } }).ok, false);
  assert.equal(parseOrIssues(MedicationItem, { ...validItem, dose: { status: 'observed', value: '500', confidence: 1.2 } }).ok, false);
  assert.equal(parseOrIssues(MedicationItem, { ...validItem, name: notFound }).ok, false);
});

test('medication_list is a scan document type with its own required and allowed fields', () => {
  assert.ok(SCAN_DOCUMENT_TYPES.includes('medication_list'));
  const required = requiredScanFields({ documentType: 'medication_list', layoutId: 'pdf-ocr-medication_list' });
  assert.deepEqual(required, ['medlist.list_date', 'medication.1.name', 'medication.1.dose', 'medication.1.unit', 'medication.1.frequency', 'medication.1.route']);
  for (const fieldId of ['medlist.prescriber_or_source', 'patient.name', 'patient.date_of_birth', 'medication.2.route', 'medication.12.name']) {
    assert.equal(allowedScanField({ documentType: 'medication_list', layoutId: 'pdf-ocr-medication_list', fieldId }), true, fieldId);
  }
  for (const fieldId of ['medication.0.name', 'medication.1.strength', 'lab.hgb.value', 'medications']) {
    assert.equal(allowedScanField({ documentType: 'medication_list', layoutId: 'pdf-ocr-medication_list', fieldId }), false, fieldId);
  }
  // Existing types are unchanged: an extra lab field is still unexpected.
  assert.equal(allowedScanField({ documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', fieldId: 'medication.2.name' }), false);
});

const fact = (fieldId, value) => ({ field_id: fieldId, value, confidence: 0.93, disposition: 'observed', citation: { ...citation, field_or_chunk_id: fieldId }, uncertainty: null });
const extractionWith = (overrides = {}) => ({ contract_version: 'w2-scan-v1', provider: 'test', status: 'complete', facts: [fact('medlist.list_date', '2026-09-22'), fact('medication.2.name', 'Lisinopril')], missing_fields: [], uncertain_fields: [], conflicts: [], issues: [], lab_results: [], intake_form: null, medication_list: validList, metrics: { pages: 1, candidate_fields: 2, accepted_fields: 2, duration_ms: 1 }, ...overrides });

test('validateScanExtraction accepts numbered medication rows and validates the typed MedicationList', () => {
  const options = { sourceDocumentId: 'src-1', documentType: 'medication_list', layoutId: 'pdf-ocr-medication_list' };
  assert.deepEqual(validateScanExtraction(extractionWith(), options).issues, []);
  const broken = validateScanExtraction(extractionWith({ medication_list: { ...validList, medications: [{ ...validItem, citation: undefined }] } }), options);
  assert.equal(broken.valid, false);
  assert.ok(broken.issues.some((issue) => issue.startsWith('medication_list.medications.0.citation')), broken.issues.join(','));
  const unexpected = validateScanExtraction(extractionWith({ facts: [fact('lab.hgb.value', '13.2')] }), options);
  assert.ok(unexpected.issues.includes('unexpected_field:lab.hgb.value'));
});

test('the HTTP-boundary typed-output validator also rejects a malformed MedicationList', () => {
  assert.equal(validateScanExtractionTypedOutput(extractionWith()).valid, true);
  const result = validateScanExtractionTypedOutput(extractionWith({ medication_list: { ...validList, list_date: undefined } }));
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.startsWith('medication_list.list_date')));
});

// --- Extraction (E4 layer 2): OCR label patterns and the typed MedicationList.
const ocrLine = (text, index, confidence = 0.95) => ({ text, page: 1, left: 100, top: 100 + index * 60, right: 1200, bottom: 140 + index * 60, confidence, words: text.split(' ') });
const fakeOcr = (texts, confidence) => ({ name: 'fake-ocr-for-tests', async recognize() { return { pageCount: 1, pages: [{ page: 1, width: 1700, height: 2200, lines: texts.map((text, index) => ocrLine(text, index, confidence)) }] }; } });
const PDF = Buffer.from('%PDF-1.4\nsynthetic medication list for tests\n');

async function extractMedicationList(texts, { confidence = 0.95, documentType = 'medication_list' } = {}) {
  const { extractPdfScanFixture } = await import('../src/pdfScanAdapter.js');
  const { extractScanForm } = await import('../src/scanFormAdapter.js');
  const prepared = await extractPdfScanFixture({ content: PDF, documentType, ocrEngine: fakeOcr(texts, confidence) });
  return extractScanForm({ sourceDocumentId: 'src-medlist', documentType, layoutId: `pdf-ocr-${documentType}`, pageCount: 1, content: prepared.content });
}

const COMPLETE_LIST = ['MEDICATION LIST', 'Patient name: Test Patient One', 'Date of birth: 1980-04-12', 'List date: 2026-09-22', 'Prescriber: Dr. Example Fictional', 'Medication 1: Metformin 500 mg twice daily oral', 'Medication 2: Lisinopril 10 mg once daily oral'];

test('medication list OCR rows map to typed rows with per-field confidence and a verbatim row citation', async () => {
  const extraction = await extractMedicationList(COMPLETE_LIST, { confidence: 0.91 });
  assert.equal(extraction.status, 'complete', JSON.stringify(extraction.issues.concat(extraction.typed_issues)));
  assert.deepEqual(extraction.typed_issues, []);
  const list = extraction.medication_list;
  assert.equal(parseOrIssues(MedicationList, list).ok, true);
  assert.equal(list.list_date.value, '2026-09-22');
  assert.equal(list.prescriber_or_source.value, 'Dr. Example Fictional');
  assert.deepEqual([list.patient.name.value, list.patient.dob.value], ['Test Patient One', '1980-04-12']);
  assert.deepEqual(list.medications.map((item) => [item.name.value, item.dose.value, item.unit.value, item.frequency.value, item.route.value]), [['Metformin', '500', 'mg', 'twice daily', 'oral'], ['Lisinopril', '10', 'mg', 'once daily', 'oral']]);
  for (const item of list.medications) {
    for (const key of ['name', 'dose', 'unit', 'frequency', 'route']) assert.equal(item[key].confidence, 0.91, key);
    assert.equal(item.citation.source_id, 'src-medlist');
    assert.match(item.citation.quote_or_value, /^Medication \d: /);
    assert.ok(item.citation.quote_or_value.includes(item.name.value));
    assert.equal(item.citation.bounding_box.length, 4);
  }
  assert.deepEqual(extraction.medication_list.medications[0].citation.field_or_chunk_id, 'medication.1.name');
  assert.equal(extraction.lab_results.length, 0);
  assert.equal(extraction.intake_form, null);
});

test('a missing prescriber and a row with no route are not_found_on_form, never invented, and the extraction is not complete', async () => {
  const extraction = await extractMedicationList(['Name: Test Patient One', 'DOB: 1980-04-12', 'Reviewed on: 2026-09-23', 'Rx 1: Metformin 500 mg twice daily oral', 'Rx 2: Aspirin 81 mg daily']);
  const list = extraction.medication_list;
  assert.deepEqual(list.prescriber_or_source, { status: 'not_found_on_form', value: null, confidence: 0, citation: null });
  assert.deepEqual(list.medications[1].route, { status: 'not_found_on_form', value: null, confidence: 0 });
  assert.equal(list.medications[1].frequency.value, 'daily');
  assert.ok(extraction.typed_issues.includes('typed_medication_incomplete:medication.2:route'));
  assert.equal(extraction.status, 'qualified');
});

test('a list with no readable rows is partial with the required first row reported missing', async () => {
  const extraction = await extractMedicationList(['MEDICATION LIST', 'List date: 2026-09-22']);
  assert.deepEqual(extraction.medication_list.medications, []);
  assert.equal(extraction.status, 'partial');
  assert.ok(extraction.missing_fields.some((field) => field.field_id === 'medication.1.name'));
});

test('lab or intake text read with the medication-list labels yields no medication rows', async () => {
  const lab = await extractMedicationList(['Hemoglobin value: 13.2', 'A1C value: 6.1', 'Hemoglobin collection date: 2026-09-20']);
  assert.equal(lab.facts.length, 0);
  const intake = await extractMedicationList(['Patient name: Test Patient One', 'Current medications: Metformin 500 mg daily', 'Allergies: Penicillin']);
  assert.deepEqual(intake.facts.map((fact) => fact.field_id), ['patient.name']);
  assert.deepEqual(intake.medication_list.medications, []);
});

test('the existing intake and lab label maps are unchanged by the medication-list layout', async () => {
  const { fieldRows } = await import('../src/pdfScanAdapter.js');
  const lines = COMPLETE_LIST.map((text, index) => ocrLine(text, index));
  assert.deepEqual(fieldRows(lines, 'lab_pdf', 'pdf-ocr-lab_pdf'), []);
  assert.deepEqual(fieldRows(lines, 'intake_form', 'pdf-ocr-intake_form').map((field) => field.field_id), ['patient.name', 'patient.date_of_birth']);
  // A medication list is only read through its own PDF-OCR layout.
  assert.deepEqual(fieldRows(lines, 'medication_list', 'external-intake-broom-road'), []);
});

test('summarizeExtractionConfidence counts medication-list fields', async () => {
  const { summarizeExtractionConfidence } = await import('../src/typedExtraction.js');
  const extraction = await extractMedicationList(COMPLETE_LIST, { confidence: 0.9 });
  const summary = summarizeExtractionConfidence(extraction);
  assert.equal(summary.count, 4 + 2 * 5);
  assert.equal(summary.min, 0.9);
});

// --- Fail loud (E4 layer 3): three-way detection and the list's identity check.
const MEDLIST_TEXT = COMPLETE_LIST.join('\n');
const LAB_TEXT = 'NORTHWIND CLINICAL LABORATORY\nHemoglobin value: 13.2\nHemoglobin unit: g/dL\nA1C reference range: under 5.7\nA1C collection date: 2026-09-20';
const INTAKE_TEXT = 'PATIENT INTAKE\nPatient name: Test Patient One\nDate of birth: 1980-04-12\nChief concern: Fatigue\nCurrent medications: Metformin 500 mg daily\nAllergies: Penicillin';

test('detection is three-way, and the existing golden documents are detected exactly as before', async () => {
  const { detectDocumentType } = await import('../src/documentSafety.js');
  const { loadGoldenFixtures } = await import('../src/w2RegressionGate.js');
  assert.equal(detectDocumentType(MEDLIST_TEXT).detected, 'medication_list');
  assert.equal(detectDocumentType(LAB_TEXT).detected, 'lab_pdf');
  // An intake form's dosed medication line must not tip it toward a medication list.
  assert.equal(detectDocumentType(INTAKE_TEXT).detected, 'intake_form');
  assert.equal(detectDocumentType(INTAKE_TEXT).medication_list_hits, 0);
  // Detected before E4 (two-way): the third type must not change any of them.
  const before = { 'lab-a': 'lab_pdf', 'lab-b': 'lab_pdf', 'intake-a': 'intake_form', 'intake-b': 'intake_form', 'gen-lab-c-table': 'lab_pdf', 'gen-lab-d-flags': 'lab_pdf', 'gen-intake-c-conflict': 'intake_form', 'gen-intake-d-dob': 'intake_form', 'gen-lab-e-scanned': 'lab_pdf', 'gen-blank-page': 'undetermined', 'gen-corrupt': 'undetermined', 'scan-text-lab-a': 'lab_pdf', 'scan-text-intake-a': 'intake_form' };
  const { docs } = loadGoldenFixtures();
  for (const [id, detected] of Object.entries(before)) assert.equal(detectDocumentType(docs.get(id).sourceText).detected, detected, id);
});

test('any declared-versus-detected mismatch between the three types is QUALIFIED doc_type_mismatch', async () => {
  const { assessDocumentSafety } = await import('../src/documentSafety.js');
  const texts = { lab_pdf: LAB_TEXT, intake_form: INTAKE_TEXT, medication_list: MEDLIST_TEXT };
  const extraction = { facts: [{ field_id: 'x' }], status: 'complete' };
  for (const declared of Object.keys(texts)) {
    for (const [actual, text] of Object.entries(texts)) {
      const safety = assessDocumentSafety({ documentType: declared, documentText: text, extraction });
      assert.equal(safety.checks.document_type.detected, actual);
      assert.equal(safety.qualifying.includes('doc_type_mismatch'), declared !== actual, `${declared} declared, ${actual} content`);
    }
  }
});

test('a medication list is checked against the chart on its printed identity: match, mismatch, unverified; zero fields is BLOCKED', async () => {
  const { assessDocumentSafety } = await import('../src/documentSafety.js');
  const extraction = await extractMedicationList(COMPLETE_LIST);
  const chart = { name: 'Test Patient One', dob: '1980-04-12' };
  const ok = assessDocumentSafety({ documentType: 'medication_list', documentText: MEDLIST_TEXT, extraction, targetPatient: chart });
  assert.deepEqual([ok.blocking, ok.qualifying, ok.checks.patient_identity.status, ok.checks.patient_identity.source], [[], [], 'match', 'medication_list_patient']);
  const other = assessDocumentSafety({ documentType: 'medication_list', documentText: MEDLIST_TEXT, extraction, targetPatient: { name: 'Test Conflict', dob: '1968-07-21' } });
  assert.deepEqual(other.blocking, ['patient_mismatch']);
  const wrongDob = assessDocumentSafety({ documentType: 'medication_list', documentText: MEDLIST_TEXT, extraction, targetPatient: { name: 'Test Patient One', dob: '1980-12-04' } });
  assert.deepEqual(wrongDob.checks.patient_identity.mismatched_fields, ['dob']);
  const anonymous = await extractMedicationList(COMPLETE_LIST.filter((line) => !/^(Patient name|Date of birth)/.test(line)));
  const unverified = assessDocumentSafety({ documentType: 'medication_list', documentText: MEDLIST_TEXT, extraction: anonymous, targetPatient: chart });
  assert.ok(unverified.qualifying.includes('patient_identity_unverified'));
  const blank = assessDocumentSafety({ documentType: 'medication_list', documentText: '', extraction: await extractMedicationList([]), targetPatient: chart });
  assert.ok(blank.blocking.includes('no_fields_extracted'));
});

// --- Workflow (E4 layer 4): evidence query and grounded answer.
test('formulateEvidenceQuery turns a medication list into a reconciliation query and leaves lab/intake queries unchanged', async () => {
  const { formulateEvidenceQuery } = await import('../src/activeWorkers.js');
  const extraction = await extractMedicationList(COMPLETE_LIST);
  assert.equal(formulateEvidenceQuery({ medicationList: extraction.medication_list }), 'Medication reconciliation: review the current medication list (Metformin, Lisinopril) against prior records.');
  assert.equal(formulateEvidenceQuery({ medicationList: { ...extraction.medication_list, medications: [] }, clinicianQuestion: 'q' }), 'q');
  assert.equal(formulateEvidenceQuery({ medicationList: null, intakeForm: { chief_concern: { status: 'observed', value: 'Fatigue' } } }), 'Chief concern: Fatigue.');
  assert.doesNotThrow(() => formulateEvidenceQuery({ medicationList: { medications: [{}] } }));
});

test('the grounded answer states each confident medication row as a cited patient fact and sends low-confidence rows to review', async () => {
  const { composeGroundedAnswer } = await import('../src/answerComposer.js');
  const { GroundedAnswerResult } = await import('../src/schemas.js');
  const confident = await extractMedicationList(COMPLETE_LIST, { confidence: 0.95 });
  const answer = await composeGroundedAnswer({ medicationList: confident.medication_list }, { provider: null });
  assert.equal(parseOrIssues(GroundedAnswerResult, answer).ok, true);
  assert.deepEqual(answer.patient_facts.map((claim) => claim.text), ['Medication 1: Metformin 500 mg twice daily oral.', 'Medication 2: Lisinopril 10 mg once daily oral.']);
  assert.ok(answer.patient_facts.every((claim) => claim.citations[0].source_type === 'document'));
  const shaky = await extractMedicationList(COMPLETE_LIST, { confidence: 0.6 });
  const reviewed = await composeGroundedAnswer({ medicationList: shaky.medication_list }, { provider: null });
  assert.equal(reviewed.patient_facts.length, 0);
  assert.deepEqual(reviewed.needs_review.map((item) => item.kind), ['medication_list_item', 'medication_list_item']);
});

test('the answer-model prompt labels medication-list rows as [medication list], not [intake form]', async () => {
  const { composeGroundedAnswer } = await import('../src/answerComposer.js');
  const extraction = await extractMedicationList(COMPLETE_LIST, { confidence: 0.95 });
  let prompt = '';
  const capture = { name: 'capture-prompt-test', model: 'test', async checkReady() { return true; }, async generate(args) { prompt = args.prompt; return { text: JSON.stringify({ claims: [] }), inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 }; } };
  await composeGroundedAnswer({ medicationList: extraction.medication_list }, { provider: capture });
  assert.match(prompt, /\[medication list\] Medication 1: Metformin 500 mg twice daily oral/);
  assert.doesNotMatch(prompt, /\[intake form\]/);
});

test('a one-line "Patient: <name> - DOB: <date>" header on a medication list yields both identity fields, not a name with a date in it', async () => {
  const extraction = await extractMedicationList(['Patient: Test Patient One - DOB: 1980-04-12', 'List date: 2026-09-22', 'Medication 1: Metformin 500 mg twice daily oral']);
  assert.deepEqual([extraction.medication_list.patient.name.value, extraction.medication_list.patient.dob.value], ['Test Patient One', '1980-04-12']);
});

// --- Extension cases (E4): the custom checks pass on the real golden run and
// fail when the run is tampered with (they are not vacuous).
test('medication-list extension checks pass on the golden medication lists and catch tampered values, citations and identity', async () => {
  const { runScenario, scan } = await import('../src/w2RegressionGate.js');
  const { checkMedicationListTyped, checkMedicationListCitations, checkMedicationListFacts } = await import('../src/extensionCases/medicationList.js');
  for (const doc of ['medlist-a', 'medlist-b']) {
    const run = await runScenario(scan(doc, 'medication_list'));
    assert.deepEqual(checkMedicationListTyped(run, { medications: 3 }), [], doc);
    assert.deepEqual(checkMedicationListCitations(run), [], doc);
    assert.deepEqual(checkMedicationListFacts(run), [], doc);
  }
  const run = await runScenario(scan('medlist-a', 'medication_list'));
  const list = run.result.workflow.typed_outputs.extraction.medication_list;
  const original = structuredClone(list);
  list.medications[0].dose.value = '850';
  assert.ok(checkMedicationListFacts(run).includes('medication[0].dose_mismatch'));
  list.medications[0].dose.value = original.medications[0].dose.value;
  list.medications[1].citation = { ...list.medications[1].citation, quote_or_value: 'Medication 2: Lisinopril 40 mg once daily oral' };
  const citationIssues = checkMedicationListCitations(run);
  assert.ok(citationIssues.includes('medication[1]:quote_not_verbatim_in_source'), citationIssues.join(','));
  assert.ok(citationIssues.includes('medication[1].dose:value_not_in_quote'));
  list.medications[1].citation = original.medications[1].citation;
  list.patient.dob = { ...list.patient.dob, value: '1980-12-04' };
  assert.ok(checkMedicationListFacts(run).includes('patient.dob_mismatch'));
  list.medications.pop();
  assert.ok(checkMedicationListTyped(run, { medications: 3 }).includes('medication_count_2_expected_3'));
});

test('the no-PHI check knows a medication list\'s identifiers (drug names, list date, identity, source)', async () => {
  const { phiIdentifiers, loadGoldenFixtures } = await import('../src/w2RegressionGate.js');
  const { words } = phiIdentifiers(loadGoldenFixtures().docs.get('medlist-b').truth);
  for (const word of ['Test Patient One', '1980-04-12', '2026-09-23', 'Northwind Pharmacy dispensing record', 'Levothyroxine', 'Albuterol 90 mcg']) assert.ok(words.includes(word), word);
});

// --- Review fix 1: a medication row that is not read never leaves the list complete.
test('a dropped medication row keeps the list QUALIFIED extraction_incomplete: unlabeled row, out-of-range number, gap in the numbering', async () => {
  const { assessDocumentSafety } = await import('../src/documentSafety.js');
  const head = ['MEDICATION LIST', 'Patient name: Test Patient One', 'Date of birth: 1980-04-12', 'List date: 2026-09-22'];
  const chart = { name: 'Test Patient One', dob: '1980-04-12' };
  const reproductions = {
    unlabeled_third_row: { lines: [...head, 'Medication 1: Metformin 500 mg twice daily oral', 'Medication 2: Lisinopril 10 mg once daily oral', 'Warfarin 5 mg once daily oral'], unreadable: 'unlabeled_medication_row' },
    row_number_100: { lines: [...head, 'Medication 1: Metformin 500 mg twice daily oral', 'Medication 100: Warfarin 5 mg once daily oral'], unreadable: 'medication_row_number_out_of_range' },
    rows_1_and_3_only: { lines: [...head, 'Medication 1: Metformin 500 mg twice daily oral', 'Medication 3: Warfarin 5 mg once daily oral'], typedIssue: 'typed_medication_row_missing:medication.2' },
  };
  for (const [name, { lines, unreadable, typedIssue }] of Object.entries(reproductions)) {
    const extraction = await extractMedicationList(lines);
    assert.notEqual(extraction.status, 'complete', name);
    if (unreadable) assert.ok(extraction.uncertain_fields.some((field) => field.reason === `unreadable:${unreadable}`), `${name}: ${JSON.stringify(extraction.uncertain_fields)}`);
    if (typedIssue) assert.ok(extraction.typed_issues.includes(typedIssue), `${name}: ${extraction.typed_issues}`);
    const safety = assessDocumentSafety({ documentType: 'medication_list', documentText: lines.join('\n'), extraction, targetPatient: chart });
    assert.deepEqual([safety.blocking, safety.qualifying], [[], ['extraction_incomplete']], name);
  }
  // The unreadable marker carries a reason code only, never the row text.
  const { extractPdfScanFixture } = await import('../src/pdfScanAdapter.js');
  const prepared = await extractPdfScanFixture({ content: PDF, documentType: 'medication_list', ocrEngine: fakeOcr(reproductions.unlabeled_third_row.lines) });
  assert.match(prepared.content.toString('utf8'), /^UNREADABLE\|field_id=medication\.unread\.1\|reason=unlabeled_medication_row$/m);
  assert.doesNotMatch(prepared.content.toString('utf8').split('\n').filter((line) => line.startsWith('UNREADABLE')).join('\n'), /Warfarin/);
  // A clean list with only titles, identity and numbered rows stays complete.
  assert.equal((await extractMedicationList(COMPLETE_LIST)).status, 'complete');
});

// --- Review fix 2: an intake with a medication table is still an intake.
const INTAKE_WITH_MEDICATION_TABLE = [
  'NEW PATIENT INTAKE',
  'Patient name: Test Patient One',
  'Date of birth: 1980-04-12',
  'Chief concern: Fatigue for two weeks',
  'Current medications (name, dose, frequency, route)',
  'Metformin 500 mg twice daily by mouth',
  'Lisinopril 10 mg once daily by mouth',
  'Preferred pharmacy: Northwind Pharmacy',
  'Allergies: Penicillin',
  'Family history: Mother has type 2 diabetes',
];

test('an intake with a "Current medications (name, dose, frequency, route)" table and a pharmacy line is detected as an intake, declared either way', async () => {
  const { assessDocumentSafety, detectDocumentType } = await import('../src/documentSafety.js');
  const text = INTAKE_WITH_MEDICATION_TABLE.join('\n');
  const detection = detectDocumentType(text);
  // Medication words are present (dose, frequency, route, pharmacy, by mouth,
  // twice daily) but no medication-list anchor, so they do not compete.
  assert.ok(detection.medication_list_hits >= 5, JSON.stringify(detection));
  assert.equal(detection.medication_list_anchor_hits, 0);
  assert.equal(detection.detected, 'intake_form');
  const asIntake = assessDocumentSafety({ documentType: 'intake_form', documentText: text, extraction: { facts: [{ field_id: 'chief_concern' }], status: 'complete' } });
  assert.equal(asIntake.qualifying.includes('doc_type_mismatch'), false);
  const asMedicationList = assessDocumentSafety({ documentType: 'medication_list', documentText: text, extraction: await extractMedicationList(INTAKE_WITH_MEDICATION_TABLE), targetPatient: { name: 'Test Patient One', dob: '1980-04-12' } });
  assert.ok(asMedicationList.qualifying.includes('doc_type_mismatch'), JSON.stringify(asMedicationList));
  assert.equal(asMedicationList.checks.document_type.detected, 'intake_form');
  // With two intake-only sections, only medication-list anchors compete: an
  // intake that also prints one list anchor is still an intake.
  assert.equal(detectDocumentType(`${text}\nPrescriber: Dr. Robin Example`).detected, 'intake_form');
  // A real medication list that also names allergies stays a medication list.
  assert.equal(detectDocumentType(`${MEDLIST_TEXT}\nAllergies: Penicillin`).detected, 'medication_list');
});
