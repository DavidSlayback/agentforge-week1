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
