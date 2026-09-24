import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { summarizeExtractionConfidence } from '../src/typedExtraction.js';
import { createRecordedOcrReplay } from '../src/pdfScanAdapter.js';
import { AgentForgeService } from '../src/service.js';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { DeterministicProvider } from '../src/modelProvider.js';
import { InMemoryTraceSink } from '../../observability/index.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';
import { SyntheticWriteback } from '../src/syntheticWriteback.js';

const golden = new URL('./fixtures/golden/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', golden), 'utf8'));
const recordings = manifest.documents.filter((doc) => doc.pdf).map((doc) => JSON.parse(fs.readFileSync(new URL(`ocr/${doc.id}.json`, golden), 'utf8')));
const pdf = (id) => fs.readFileSync(new URL(manifest.documents.find((doc) => doc.id === id).pdf, new URL('../../', import.meta.url)));
const fixturePath = fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url));
const SECRET = 'extraction-confidence-test-secret';
const context = (patient, scope = 'read-briefing') => verifySignedContext(issueSignedContext({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', scope, acl: scope === 'read-briefing' ? 'read' : 'write', secret: SECRET }), SECRET);

test('extraction confidence summarizer returns nulls and 0 for empty extraction', () => {
  const result = summarizeExtractionConfidence(null);
  assert.equal(result.mean, null);
  assert.equal(result.min, null);
  assert.equal(result.count, 0);
});

test('extraction confidence summarizer returns nulls and 0 when no confidences are found', () => {
  const extraction = {
    status: 'complete',
    facts: [],
    lab_results: [],
    intake_form: {
      demographics: {
        name: { status: 'not_found_on_form', value: null, confidence: 0, citation: null },
        dob: { status: 'not_found_on_form', value: null, confidence: 0, citation: null },
      },
      chief_concern: { status: 'not_found_on_form', value: null, confidence: 0, citation: null },
      current_medications: [],
      allergies: [],
      family_history: [],
    },
  };
  const result = summarizeExtractionConfidence(extraction);
  assert.equal(result.mean, null);
  assert.equal(result.min, null);
  assert.equal(result.count, 0);
});

test('extraction confidence summarizer computes mean and min from lab results only', () => {
  const citation = { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'field-1', quote_or_value: 'test' };
  const extraction = {
    status: 'complete',
    facts: [],
    lab_results: [
      { test_name: 'HGB', value: '13.2', unit: 'g/dL', reference_range: '12-16', collection_date: '2026-09-24', abnormal_flag: 'normal', confidence: 0.95, citation },
      { test_name: 'A1C', value: '6.1', unit: '%', reference_range: '<5.7', collection_date: '2026-09-24', abnormal_flag: 'normal', confidence: 0.85, citation },
    ],
    intake_form: {
      demographics: {
        name: { status: 'not_found_on_form', value: null, confidence: 0, citation: null },
        dob: { status: 'not_found_on_form', value: null, confidence: 0, citation: null },
      },
      chief_concern: { status: 'not_found_on_form', value: null, confidence: 0, citation: null },
      current_medications: [],
      allergies: [],
      family_history: [],
    },
  };
  const result = summarizeExtractionConfidence(extraction);
  assert.equal(result.mean, 0.9); // (0.95 + 0.85) / 2 = 0.9
  assert.equal(result.min, 0.85);
  assert.equal(result.count, 2);
});

test('extraction confidence summarizer computes mean and min from intake form observed count', () => {
  const citation = { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'field-1', quote_or_value: 'test' };
  const extraction = {
    status: 'complete',
    facts: [],
    lab_results: [],
    intake_form: {
      demographics: {
        name: { status: 'observed', value: 'Test Patient', confidence: 0.92, citation },
        dob: { status: 'observed', value: '1980-04-12', confidence: 0.88, citation },
        phone: { status: 'observed', value: '555-0123', confidence: 0.91, citation },
      },
      chief_concern: { status: 'observed', value: 'Fatigue', confidence: 0.85, citation },
      current_medications: [
        { status: 'observed', value: 'Metformin', confidence: 0.94, citation },
      ],
      allergies: [
        { status: 'observed', value: 'Penicillin', confidence: 0.96, citation },
      ],
      family_history: [],
    },
  };
  const result = summarizeExtractionConfidence(extraction);
  // (0.92 + 0.88 + 0.91 + 0.85 + 0.94 + 0.96) / 6 = 5.46 / 6 = 0.91
  assert.equal(result.mean, 0.91);
  assert.equal(result.min, 0.85);
  assert.equal(result.count, 6);
});

test('extraction confidence summarizer combines lab and intake confidences', () => {
  const citation = { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'field-1', quote_or_value: 'test' };
  const extraction = {
    status: 'complete',
    facts: [],
    lab_results: [
      { test_name: 'HGB', value: '13.2', unit: 'g/dL', reference_range: '12-16', collection_date: '2026-09-24', abnormal_flag: 'normal', confidence: 0.9, citation },
    ],
    intake_form: {
      demographics: {
        name: { status: 'observed', value: 'Test Patient', confidence: 0.8, citation },
        dob: { status: 'observed', value: '1980-04-12', confidence: 0.75, citation },
      },
      chief_concern: { status: 'observed', value: 'Fatigue', confidence: 0.85, citation },
      current_medications: [],
      allergies: [],
      family_history: [],
    },
  };
  const result = summarizeExtractionConfidence(extraction);
  // (0.9 + 0.8 + 0.75 + 0.85) / 4 = 3.3 / 4 = 0.825 -> 0.83
  assert.equal(result.mean, 0.83);
  assert.equal(result.min, 0.75);
  assert.equal(result.count, 4);
});

test('extraction confidence summarizer rounds mean and min to 2 decimals', () => {
  const citation = { source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'field-1', quote_or_value: 'test' };
  const extraction = {
    status: 'complete',
    facts: [],
    lab_results: [
      { test_name: 'HGB', value: '13.2', unit: 'g/dL', reference_range: '12-16', collection_date: '2026-09-24', abnormal_flag: 'normal', confidence: 0.333, citation },
      { test_name: 'A1C', value: '6.1', unit: '%', reference_range: '<5.7', collection_date: '2026-09-24', abnormal_flag: 'normal', confidence: 0.666, citation },
    ],
    intake_form: {
      demographics: {
        name: { status: 'not_found_on_form', value: null, confidence: 0, citation: null },
        dob: { status: 'not_found_on_form', value: null, confidence: 0, citation: null },
      },
      chief_concern: { status: 'not_found_on_form', value: null, confidence: 0, citation: null },
      current_medications: [],
      allergies: [],
      family_history: [],
    },
  };
  const result = summarizeExtractionConfidence(extraction);
  // (0.333 + 0.666) / 2 = 0.9995 -> 0.9995 * 100 = 99.95, rounded to 100 / 100 = 1.0? No, let me recalculate.
  // (0.333 + 0.666) / 2 = 0.4995. 0.4995 * 100 = 49.95, rounded = 50, then / 100 = 0.5
  assert.equal(result.mean, 0.5);
  assert.equal(result.min, 0.33);
  assert.equal(result.count, 2);
});

test('extraction confidence survives redaction in stored trace with a golden lab PDF', async () => {
  const writeback = new SyntheticWriteback();
  const traceSink = new InMemoryTraceSink();
  const service = new AgentForgeService({
    chartAdapter: new FixtureAdapter(fixturePath),
    writeback,
    provider: new DeterministicProvider(),
    traceSink,
    ocrEngine: createRecordedOcrReplay(recordings),
  });
  const patientId = 'fixture-patient-001';
  const upload = await service.ingestSourceDocument(
    { patient_uuid: patientId, clinician_uuid: 'fixture-physician-001', document_type: 'lab_pdf', filename: 'lab-a.pdf', content: pdf('lab-a') },
    { verifiedContext: context(patientId, 'write-source-document') },
  );
  assert.ok(upload && upload.source_document && upload.source_document.id, 'upload should have source_document.id');
  const result = await service.runActiveSupervisorForDocument(
    upload.source_document.id,
    { patient_uuid: patientId, clinician_uuid: 'fixture-physician-001' },
    { verifiedContext: context(patientId), query: 'glycemic follow-up with medication history' },
  );
  assert.equal(result.workflow.final_state, 'READY');
  const traces = traceSink.list();
  assert.ok(traces.length > 0);
  const trace = traces[traces.length - 1];
  assert.ok(trace.extraction, `trace should have extraction: ${JSON.stringify(trace)}`);
  assert.ok(trace.extraction.confidence, `extraction should have confidence: ${JSON.stringify(trace.extraction)}`);
  console.log('Confidence object:', JSON.stringify(trace.extraction.confidence));
  assert.equal(typeof trace.extraction.confidence.mean, 'number', `mean should be number, got: ${trace.extraction.confidence.mean}`);
  assert.equal(typeof trace.extraction.confidence.min, 'number', `min should be number, got: ${trace.extraction.confidence.min}`);
  assert.equal(typeof trace.extraction.confidence.count, 'number', `count should be number, got: ${trace.extraction.confidence.count}`);
  assert.ok(trace.extraction.confidence.mean > 0);
  assert.ok(trace.extraction.confidence.min > 0);
  assert.ok(trace.extraction.confidence.count > 0);
  // Verify that the numeric values are actually present in the serialized trace
  const serialized = JSON.stringify(trace);
  assert.ok(serialized.includes('"mean"'));
  assert.ok(serialized.includes('"min"'));
  assert.ok(serialized.includes('"count"'));
});
