import test from 'node:test';
import assert from 'node:assert/strict';
import { extractScanForm } from '../src/scanFormAdapter.js';
import { extractPdfScanFixture, fieldRows, parseTsv } from '../src/pdfScanAdapter.js';
import { PDF_SCAN_FIELDS } from '../src/scanFormContracts.js';
import { abnormalFlagFrom } from '../src/typedExtraction.js';

const asFixture = (fields, documentType) => Buffer.from([
  `SYNTHETIC_SCAN_FORM|layout=pdf-ocr-${documentType}|page_count=1`,
  ...fields.map((field, i) => `FIELD|field_id=${field.field_id}|label=${field.label}|value=${field.value}|quote=${field.quote || ''}|page=${field.line.page}|box=${field.line.left},${field.line.top},${field.line.right},${field.line.bottom}|confidence=${field.line.confidence}`),
].join('\n'));

test('Tesseract word rows group into a cited synthetic intake field', () => {
  const tsv = [
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
    '5\t1\t1\t1\t1\t1\t20\t30\t65\t15\t95\tReason',
    '5\t1\t1\t1\t1\t2\t90\t30\t40\t15\t93\tfor',
    '5\t1\t1\t1\t1\t3\t135\t30\t55\t15\t92\tvisit',
    '5\t1\t1\t1\t1\t4\t200\t30\t70\t15\t91\tFatigue',
  ].join('\n');
  const lines = parseTsv(tsv, 1);
  const fields = fieldRows(lines, 'intake_form');
  assert.equal(lines.length, 1);
  assert.equal(fields[0].field_id, 'chief_concern');
  assert.equal(fields[0].value, 'Fatigue');
  assert.deepEqual(fields[0].line && [fields[0].line.left, fields[0].line.top, fields[0].line.right, fields[0].line.bottom], [20, 30, 270, 45]);
});

test('PDF OCR adapter rejects non-PDF content before invoking system tools', async () => {
  await assert.rejects(extractPdfScanFixture({ content: Buffer.from('not a pdf'), documentType: 'lab_pdf' }), /SOURCE_DOCUMENT_PDF_INVALID/);
});

test('PDF lab schema captures name, value, unit, range, date, and abnormal status for two tests', () => {
  const labels = ['Hemoglobin test name', 'Hemoglobin value', 'Hemoglobin unit', 'Hemoglobin reference range', 'Hemoglobin collection date', 'Hemoglobin abnormal', 'A1C test name', 'A1C value', 'A1C unit', 'A1C reference range', 'A1C collection date', 'A1C abnormal'];
  const values = ['Hemoglobin', '13.2', 'g/dL', '12.0-16.0', '2026-09-20', 'No', 'A1C', '6.1', '%', 'under 5.7', '2026-09-20', 'No'];
  const lines = labels.map((label, i) => ({ text: `${label}: ${values[i]}`, page: 1, left: 10, top: i * 20, right: 250, bottom: i * 20 + 15, confidence: 0.95 }));
  const fields = fieldRows(lines, 'lab_pdf', 'pdf-ocr-lab_pdf');
  assert.deepEqual(fields.map((field) => field.field_id), PDF_SCAN_FIELDS.lab_pdf);
  assert.equal(fields.find((field) => field.field_id === 'lab.hgb.value').value, '13.2');
  assert.equal(fields.find((field) => field.field_id === 'lab.a1c.abnormal').value, 'No');
  const extraction = extractScanForm({ sourceDocumentId: 'pdf-lab-contract', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: asFixture(fields, 'lab_pdf') });
  assert.equal(extraction.status, 'complete');
  assert.ok(extraction.facts.every((fact) => fact.citation.coordinate_space === 'raster_pixels_200dpi'));
  assert.equal(extraction.lab_results.length, 2);
  assert.deepEqual(extraction.lab_results.map((result) => result.test_name).sort(), ['A1C', 'Hemoglobin']);
  assert.equal(extraction.lab_results.find((result) => result.test_name === 'Hemoglobin').abnormal_flag, 'normal');
  assert.equal(extraction.typed_issues.length, 0);
});

test('PDF intake schema captures demographics, concern, medications, allergies, and family history', () => {
  const rows = [
    ['Patient name', 'Alex Morgan'], ['Date of birth', '1980-04-12'], ['Phone', '555-0100'],
    ['Reason for visit', 'Fatigue for two weeks'], ['Current medications', 'Metformin 500 mg daily'],
    ['Allergies', 'Penicillin'], ['Family history', 'Mother has type 2 diabetes'],
  ].map(([label, value], i) => ({ text: `${label}: ${value}`, page: 1, left: 10, top: i * 20, right: 300, bottom: i * 20 + 15, confidence: 0.95 }));
  const fields = fieldRows(rows, 'intake_form', 'pdf-ocr-intake_form');
  assert.deepEqual(fields.map((field) => field.field_id), PDF_SCAN_FIELDS.intake_form);
  assert.equal(fields.find((field) => field.field_id === 'family_history').value, 'Mother has type 2 diabetes');
  const extraction = extractScanForm({ sourceDocumentId: 'pdf-intake-contract', documentType: 'intake_form', layoutId: 'pdf-ocr-intake_form', content: asFixture(fields, 'intake_form') });
  assert.equal(extraction.status, 'complete');
  assert.equal(extraction.facts.length, PDF_SCAN_FIELDS.intake_form.length);
  assert.equal(extraction.facts.find((fact) => fact.field_id === 'patient.name').citation.quote_or_value, 'Patient name: Alex Morgan');
  assert.equal(extraction.intake_form.demographics.name.value, 'Alex Morgan');
  assert.equal(extraction.intake_form.demographics.name.status, 'observed');
  assert.equal(extraction.intake_form.current_medications[0].value, 'Metformin 500 mg daily');
  assert.equal(extraction.intake_form.family_history[0].value, 'Mother has type 2 diabetes');
  const incomplete = extractScanForm({ sourceDocumentId: 'pdf-intake-partial', documentType: 'intake_form', layoutId: 'pdf-ocr-intake_form', content: asFixture(fields.slice(0, -1), 'intake_form') });
  assert.equal(incomplete.status, 'partial');
  assert.deepEqual(incomplete.missing_fields.map((field) => field.field_id), ['family_history']);
});

test('abnormal-flag tokens map to the strict AbnormalFlag enum, case-insensitively', () => {
  assert.equal(abnormalFlagFrom('Yes'), 'abnormal');
  assert.equal(abnormalFlagFrom('No'), 'normal');
  assert.equal(abnormalFlagFrom('H'), 'high');
  assert.equal(abnormalFlagFrom('h'), 'high');
  assert.equal(abnormalFlagFrom('L'), 'low');
  assert.equal(abnormalFlagFrom('Y'), 'abnormal');
  assert.equal(abnormalFlagFrom('N'), 'normal');
  assert.equal(abnormalFlagFrom('sideways'), 'unknown');
  assert.equal(abnormalFlagFrom(''), 'unknown');
});

test('PDF lab schema maps "Yes"/"No" abnormal tokens onto the typed LabResult per test', () => {
  const labels = ['Hemoglobin test name', 'Hemoglobin value', 'Hemoglobin unit', 'Hemoglobin reference range', 'Hemoglobin collection date', 'Hemoglobin abnormal', 'A1C test name', 'A1C value', 'A1C unit', 'A1C reference range', 'A1C collection date', 'A1C abnormal'];
  const values = ['Hemoglobin', '11.9', 'g/dL', '12.0-16.0', '2026-09-21', 'Yes', 'A1C', '7.2', '%', 'under 5.7', '2026-09-21', 'No'];
  const lines = labels.map((label, i) => ({ text: `${label}: ${values[i]}`, page: 1, left: 10, top: i * 20, right: 250, bottom: i * 20 + 15, confidence: 0.95 }));
  const fields = fieldRows(lines, 'lab_pdf', 'pdf-ocr-lab_pdf');
  const extraction = extractScanForm({ sourceDocumentId: 'pdf-lab-yes-no', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: asFixture(fields, 'lab_pdf') });
  assert.equal(extraction.lab_results.find((result) => result.test_name === 'Hemoglobin').abnormal_flag, 'abnormal');
  assert.equal(extraction.lab_results.find((result) => result.test_name === 'A1C').abnormal_flag, 'normal');
});

test('citation quote_or_value carries the verbatim OCR line, not the canonical field label', () => {
  // The raw OCR line uses different capitalization and spacing than the
  // canonical label ("Patient name") the adapter maps it to; the citation
  // must preserve what the form actually says, not the reconstructed label.
  const lines = [{ text: 'PATIENT NAME:   Alex Morgan', page: 1, left: 10, top: 0, right: 300, bottom: 15, confidence: 0.95 }];
  const fields = fieldRows(lines, 'intake_form', 'pdf-ocr-intake_form');
  assert.equal(fields[0].quote, 'PATIENT NAME:   Alex Morgan');
  const extraction = extractScanForm({ sourceDocumentId: 'pdf-verbatim-quote', documentType: 'intake_form', layoutId: 'pdf-ocr-intake_form', content: asFixture(fields, 'intake_form') });
  assert.equal(extraction.facts[0].citation.quote_or_value, 'PATIENT NAME:   Alex Morgan');
});
