import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Citation, GuidelineEvidence, IntakeForm, LabResult, parseOrIssues } from '../src/schemas.js';
import { extractScanForm } from '../src/scanFormAdapter.js';
import { extractPdfScanFixture } from '../src/pdfScanAdapter.js';
import { extractLabEvidence } from '../src/labEvidence.js';
import { extractIntakeEvidence } from '../src/intakeEvidence.js';

const validCitation = { source_type: 'document', source_id: 'src-1', page_or_section: 'page 1', field_or_chunk_id: 'lab.hgb.value', quote_or_value: 'Hemoglobin 13.2 g/dL' };

const validLabResult = { test_name: 'Hemoglobin', value: '13.2', unit: 'g/dL', reference_range: '12-16', collection_date: '2026-09-20', abnormal_flag: 'normal', confidence: 0.97, citation: validCitation };

const observedField = { status: 'observed', value: 'Alex Morgan', confidence: 0.95, citation: validCitation };
const notFoundField = { status: 'not_found_on_form', value: null, confidence: 0, citation: null };
const validIntakeForm = {
  demographics: { name: observedField, dob: observedField },
  chief_concern: observedField,
  current_medications: [observedField],
  allergies: [],
  family_history: [],
};

const validGuidelineEvidence = { title: 'Synthetic guideline', section: 'Review', version: '2026.1', snippet: 'Review documented evidence.', sparse_score: 1, dense_score: 0.5, rerank_score: 0.9, matched_terms: ['review'], citation: { source_type: 'guideline', source_id: 'guideline-1', page_or_section: 'Review', field_or_chunk_id: 'guideline-1', quote_or_value: 'Review documented evidence.' } };

test('Citation requires exactly the five W2 keys and rejects the old key names', () => {
  assert.equal(parseOrIssues(Citation, validCitation).ok, true);
  for (const field of ['source_type', 'source_id', 'page_or_section', 'field_or_chunk_id', 'quote_or_value']) {
    const { [field]: _dropped, ...withoutField } = validCitation;
    assert.equal(parseOrIssues(Citation, withoutField).ok, false, `Citation must require ${field}`);
  }
  for (const oldKey of ['source_document_id', 'page', 'field_id', 'quote', 'location', 'layout_id']) {
    assert.equal(parseOrIssues(Citation, { ...validCitation, [oldKey]: 'legacy-value' }).ok, false, `Citation must reject the old key ${oldKey}`);
  }
  assert.equal(parseOrIssues(Citation, { ...validCitation, source_type: 'lab_pdf' }).ok, false);
  assert.equal(parseOrIssues(Citation, { ...validCitation, bounding_box: [1, 2, 3, 4] }).ok, true);
  assert.equal(parseOrIssues(Citation, { ...validCitation, bounding_box: [1, 2, 3] }).ok, false);
  assert.equal(parseOrIssues(Citation, { ...validCitation, bounding_box: [1, 2, -3, 4] }).ok, false);
});

test('LabResult requires every listed field', () => {
  assert.equal(parseOrIssues(LabResult, validLabResult).ok, true);
  for (const field of ['test_name', 'value', 'unit', 'reference_range', 'collection_date', 'abnormal_flag', 'confidence', 'citation']) {
    const { [field]: _dropped, ...withoutField } = validLabResult;
    assert.equal(parseOrIssues(LabResult, withoutField).ok, false, `LabResult must require ${field}`);
  }
  assert.equal(parseOrIssues(LabResult, { ...validLabResult, abnormal_flag: 'yes' }).ok, false);
  assert.equal(parseOrIssues(LabResult, { ...validLabResult, confidence: 1.5 }).ok, false);
  assert.equal(parseOrIssues(LabResult, { ...validLabResult, citation: { ...validCitation, source_document_id: 'src-1' } }).ok, false);
});

test('IntakeForm requires every listed section, present even when empty', () => {
  assert.equal(parseOrIssues(IntakeForm, validIntakeForm).ok, true);
  for (const field of ['demographics', 'chief_concern', 'current_medications', 'allergies', 'family_history']) {
    const { [field]: _dropped, ...withoutField } = validIntakeForm;
    assert.equal(parseOrIssues(IntakeForm, withoutField).ok, false, `IntakeForm must require ${field}`);
  }
  for (const field of ['name', 'dob']) {
    const { [field]: _dropped, ...withoutField } = validIntakeForm.demographics;
    assert.equal(parseOrIssues(IntakeForm, { ...validIntakeForm, demographics: withoutField }).ok, false, `IntakeForm.demographics must require ${field}`);
  }
  // Empty arrays are valid: "no data extracted" is not the same as "section omitted".
  assert.equal(parseOrIssues(IntakeForm, { ...validIntakeForm, current_medications: [] }).ok, true);
  // "Not found on the form" is an explicit, typed status rather than a missing key.
  assert.equal(parseOrIssues(IntakeForm, { ...validIntakeForm, chief_concern: notFoundField }).ok, true);
  assert.equal(parseOrIssues(IntakeForm, { ...validIntakeForm, chief_concern: { value: null } }).ok, false);
});

test('GuidelineEvidence requires a nested five-key citation and the score/snippet fields', () => {
  assert.equal(parseOrIssues(GuidelineEvidence, validGuidelineEvidence).ok, true);
  for (const field of ['title', 'section', 'version', 'snippet', 'matched_terms', 'citation']) {
    const { [field]: _dropped, ...withoutField } = validGuidelineEvidence;
    assert.equal(parseOrIssues(GuidelineEvidence, withoutField).ok, false, `GuidelineEvidence must require ${field}`);
  }
  assert.equal(parseOrIssues(GuidelineEvidence, { ...validGuidelineEvidence, citation: { ...validGuidelineEvidence.citation, location: 'synthetic://x' } }).ok, false);
});

test('text-fixture lab and intake extraction produce citations that validate against the Citation schema', () => {
  const labExtraction = extractLabEvidence({ sourceDocumentId: 'src-lab-1', content: Buffer.from('LAB|test=Hemoglobin|value=13.2|unit=g/dL|reference_range=12-16|collection_date=2026-09-20|abnormal=false|page=1|field_id=lab.hgb|quote=Hemoglobin 13.2 g/dL|bounding_box=10,20,100,40') });
  assert.equal(labExtraction.status, 'complete');
  assert.equal(parseOrIssues(Citation, labExtraction.facts[0].citation).ok, true);
  assert.equal(parseOrIssues(LabResult, labExtraction.lab_results[0]).ok, true);

  const intakeExtraction = extractIntakeEvidence({ sourceDocumentId: 'src-intake-1', content: Buffer.from('INTAKE|field=chief_concern|value=Fatigue for two weeks|section=Reason for visit|page=1|field_id=intake.concern|quote=Fatigue for two weeks|bounding_box=10,20,100,40') });
  assert.equal(intakeExtraction.status, 'complete');
  assert.equal(parseOrIssues(Citation, intakeExtraction.facts[0].citation).ok, true);

  // grep-style guard, in-process: no legacy citation key survives in either extraction.
  const serialized = JSON.stringify([labExtraction.facts[0].citation, intakeExtraction.facts[0].citation]);
  for (const oldKey of ['source_document_id', '"page"', 'field_id', '"quote"', '"location"']) {
    assert.equal(serialized.includes(oldKey), false, `${oldKey} must not appear in a citation object`);
  }
});

function toolsOnPath() {
  for (const tool of ['pdftoppm', 'tesseract']) {
    const probe = spawnSync(tool, ['-v'], { stdio: 'ignore' });
    if (probe.error || probe.status === null) return false;
  }
  return true;
}

const pdfSamplesDir = fileURLToPath(new URL('../../docs/agentforge/fixtures/scan-forms/pdf-samples/', import.meta.url));
const pdfManifest = JSON.parse(fs.readFileSync(`${pdfSamplesDir}manifest.json`, 'utf8'));
const labASample = pdfManifest.samples.find((sample) => sample.layout === 'lab-a');

test('real scan path on a sample lab PDF produces schema-valid typed LabResult objects matching the manifest', { skip: !toolsOnPath() ? 'pdftoppm/tesseract are not on PATH on this machine; the PDF-OCR path is untested here (verify in CI or the container, which install poppler-utils/tesseract-ocr).' : false }, async () => {
  const content = fs.readFileSync(`${pdfSamplesDir}${labASample.filename}`);
  const prepared = await extractPdfScanFixture({ content, documentType: 'lab_pdf' });
  const extraction = extractScanForm({ sourceDocumentId: 'pdf-sample-lab-a', documentType: 'lab_pdf', layoutId: `pdf-ocr-lab_pdf`, pageCount: prepared.pageCount, content: prepared.content });
  assert.equal(extraction.status, 'complete');
  assert.equal(extraction.typed_issues.length, 0);
  assert.equal(extraction.lab_results.length, 2);
  for (const result of extraction.lab_results) {
    const parsed = parseOrIssues(LabResult, result);
    assert.equal(parsed.ok, true, parsed.issues.join(', '));
  }
  // Assert against the manifest's expected_fields, not just schema validity,
  // so a value/unit/flag regression in OCR or typed-conversion is caught.
  const expected = labASample.expected_fields;
  for (const [testKey, flagKey] of [['hgb', 'lab.hgb'], ['a1c', 'lab.a1c']]) {
    const result = extraction.lab_results.find((item) => item.test_name === expected[`${flagKey}.test_name`]);
    assert.ok(result, `expected a typed LabResult for ${testKey}`);
    assert.equal(result.value, expected[`${flagKey}.value`]);
    assert.equal(result.unit, expected[`${flagKey}.unit`]);
    assert.equal(result.reference_range, expected[`${flagKey}.reference_range`]);
    assert.equal(result.collection_date, expected[`${flagKey}.collection_date`]);
    assert.equal(result.abnormal_flag, expected[`${flagKey}.abnormal`] === 'Yes' ? 'abnormal' : 'normal');
  }
});

const schemasDocsDir = fileURLToPath(new URL('../../docs/agentforge/schemas/', import.meta.url));
const EXPORTED_SCHEMAS = { Citation, LabResult, IntakeForm, GuidelineEvidence };

test('committed JSON Schema docs match what schemas.js generates today', () => {
  for (const [name, schema] of Object.entries(EXPORTED_SCHEMAS)) {
    const regenerated = z.toJSONSchema(schema, { target: 'draft-2020-12' });
    regenerated.title = name;
    const committed = JSON.parse(fs.readFileSync(`${schemasDocsDir}${name}.json`, 'utf8'));
    assert.deepEqual(regenerated, committed, `docs/agentforge/schemas/${name}.json is stale; run \`npm run export:schemas --prefix agentforge\``);
  }
});
