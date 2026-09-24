import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { InMemoryTraceSink } from '../../observability/index.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';
import { traceSafeHandoff } from '../src/activeWorkers.js';
import { assessDocumentSafety, checkPatientIdentity, detectDocumentType, normalizeDob } from '../src/documentSafety.js';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { DeterministicProvider } from '../src/modelProvider.js';
import { createRecordedOcrReplay } from '../src/pdfScanAdapter.js';
import { AgentForgeService } from '../src/service.js';
import { runActiveSupervisor, runDeterministicSupervisor } from '../src/supervisor.js';
import { SyntheticWriteback } from '../src/syntheticWriteback.js';
import { renderScanSourcePreview } from '../src/ui.js';

const fixturePath = fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url));
const golden = new URL('./fixtures/golden/', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('manifest.json', golden), 'utf8'));
const recordings = manifest.documents.filter((doc) => doc.pdf).map((doc) => JSON.parse(fs.readFileSync(new URL(`ocr/${doc.id}.json`, golden), 'utf8')));
const pdf = (id) => fs.readFileSync(new URL(manifest.documents.find((doc) => doc.id === id).pdf, new URL('../../', import.meta.url)));
const SECRET = 'fail-loud-test-secret';
const context = (patient, scope = 'read-briefing') => verifySignedContext(issueSignedContext({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', scope, acl: scope === 'read-briefing' ? 'read' : 'write', secret: SECRET }), SECRET);

function serviceWithReplay() {
  const writeback = new SyntheticWriteback();
  const traceSink = new InMemoryTraceSink();
  const service = new AgentForgeService({ chartAdapter: new FixtureAdapter(fixturePath), writeback, provider: new DeterministicProvider(), traceSink, ocrEngine: createRecordedOcrReplay(recordings) });
  const run = async (docId, declaredType, { uploadPatient = 'fixture-patient-001', requestPatient = uploadPatient, query = 'glycemic follow-up with medication history' } = {}) => {
    const upload = service.ingestSourceDocument({ patient_uuid: uploadPatient, clinician_uuid: 'fixture-physician-001', document_type: declaredType, filename: `${docId}.pdf`, content: pdf(docId) }, { verifiedContext: context(uploadPatient, 'write-source-document') });
    return service.runActiveSupervisorForDocument(upload.source_document.id, { patient_uuid: requestPatient, clinician_uuid: 'fixture-physician-001' }, { verifiedContext: context(requestPatient), query });
  };
  return { service, traceSink, run };
}

const envelope = (documentType, rows) => Buffer.from([`SYNTHETIC_SCAN_FORM|layout=pdf-ocr-${documentType}|page_count=1`, ...rows.map(([fieldId, value], index) => `FIELD|field_id=${fieldId}|label=${fieldId}|value=${value}|unit=|quote=${fieldId}: ${value}|page=1|box=10,${index * 20},300,${index * 20 + 15}|confidence=0.95`)].join('\n'));
const INTAKE_OCR = 'Patient name: Test Patient One\nDate of birth: 1980-04-12\nReason for visit: Fatigue\nCurrent medications: Metformin\nAllergies: Penicillin\nFamily history: Diabetes';
const LAB_OCR = 'Laboratory results\nHemoglobin value: 13.2\nHemoglobin unit: g/dL\nHemoglobin reference range: 12.0-16.0\nA1C value: 6.1';

test('document type is detected from keyword vocabulary, and a weak signal stays undetermined', () => {
  assert.equal(detectDocumentType(LAB_OCR).detected, 'lab_pdf');
  assert.equal(detectDocumentType(INTAKE_OCR).detected, 'intake_form');
  assert.equal(detectDocumentType('Allergies: none').detected, 'undetermined');
  assert.equal(detectDocumentType('').detected, 'undetermined');
});

test('patient identity check matches, mismatches and refuses to guess', () => {
  const form = (name, dob) => ({ demographics: { name: name ? { status: 'observed', value: name } : { status: 'not_found_on_form' }, dob: dob ? { status: 'observed', value: dob } : { status: 'not_found_on_form' } } });
  const chart = { name: 'Test Patient One', dob: '1980-04-12' };
  assert.equal(checkPatientIdentity(form('TEST  patient one', '04/12/1980'), chart).status, 'match');
  assert.deepEqual(checkPatientIdentity(form('Test Conflict', '1968-07-21'), chart), { status: 'mismatch', mismatched_fields: ['name', 'dob'] });
  assert.deepEqual(checkPatientIdentity(form('Test Patient One', '1980-04-13'), chart).mismatched_fields, ['dob']);
  assert.equal(checkPatientIdentity(form(null, null), chart).status, 'unverified');
  assert.equal(checkPatientIdentity(form('Test Patient One', 'twelfth of April'), chart).status, 'unverified');
  assert.equal(checkPatientIdentity(form('Test Patient One', '1980-04-12'), null).status, 'unverified');
  assert.equal(normalizeDob('4/2/1980'), '1980-04-02');
});

test('zero extracted facts is BLOCKED no_fields_extracted before retrieval, on both supervisors', () => {
  const active = runActiveSupervisor({ sourceDocumentId: 'doc-empty', documentType: 'lab_pdf', layoutId: 'pdf-ocr-lab_pdf', content: envelope('lab_pdf', []), query: 'glycemic follow-up', documentText: '' });
  assert.equal(active.final_state, 'BLOCKED');
  assert.equal(active.stop_reason, 'no_fields_extracted');
  assert.equal(active.typed_outputs.evidence, null);
  const text = runDeterministicSupervisor({ intakeResult: { status: 'qualified', facts: [], documents: [] }, evidenceResult: { status: 'ready', patient_facts: [], guideline_evidence: [] } });
  assert.equal(text.final_state, 'BLOCKED');
  assert.equal(text.stop_reason, 'no_fields_extracted');
});

test('a declared type contradicted by the document text is QUALIFIED doc_type_mismatch, never READY', () => {
  const result = runActiveSupervisor({ sourceDocumentId: 'doc-mismatch', documentType: 'intake_form', layoutId: 'pdf-ocr-intake_form', content: envelope('intake_form', [['patient.name', 'Test Patient One'], ['patient.date_of_birth', '1980-04-12']]), query: 'glycemic follow-up with medication history', documentText: LAB_OCR, targetPatient: { name: 'Test Patient One', dob: '1980-04-12' } });
  assert.equal(result.final_state, 'QUALIFIED');
  assert.ok(result.qualification.reasons.includes('doc_type_mismatch'));
  assert.deepEqual(result.safety_checks.document_type, { declared: 'intake_form', detected: 'lab_pdf', status: 'mismatch' });
});

test('intake demographics that contradict the chart are BLOCKED patient_mismatch', () => {
  const content = envelope('intake_form', [['patient.name', 'Test Conflict'], ['patient.date_of_birth', '1968-07-21'], ['chief_concern', 'Headache']]);
  const result = runActiveSupervisor({ sourceDocumentId: 'doc-other', documentType: 'intake_form', layoutId: 'pdf-ocr-intake_form', content, query: 'medication reconciliation', documentText: INTAKE_OCR, targetPatient: { name: 'Test Patient One', dob: '1980-04-12' } });
  assert.equal(result.final_state, 'BLOCKED');
  assert.equal(result.stop_reason, 'patient_mismatch');
  assert.deepEqual(result.safety_checks.patient_identity.mismatched_fields, ['name', 'dob']);
  assert.equal(assessDocumentSafety({ documentType: 'intake_form', documentText: INTAKE_OCR, extraction: { status: 'complete', facts: [{}], intake_form: null }, targetPatient: null }).qualifying.includes('patient_identity_unverified'), true);
});

test('service scan path on recorded golden OCR: table lab BLOCKED, other-patient intake BLOCKED, lab-as-intake QUALIFIED', async () => {
  const { run } = serviceWithReplay();
  const table = await run('gen-lab-c-table', 'lab_pdf');
  assert.equal(table.workflow.stop_reason, 'no_fields_extracted');
  const other = await run('gen-intake-c-conflict', 'intake_form');
  assert.equal(other.workflow.stop_reason, 'patient_mismatch');
  const own = await run('gen-intake-c-conflict', 'intake_form', { uploadPatient: 'fixture-patient-002', query: 'medication reconciliation of the current list against prior records' });
  assert.equal(own.workflow.final_state, 'READY');
  const labAsIntake = await run('gen-lab-c-table', 'intake_form');
  assert.equal(labAsIntake.workflow.final_state, 'QUALIFIED');
  assert.ok(labAsIntake.workflow.qualification.reasons.includes('doc_type_mismatch'));
  const clean = await run('lab-a', 'lab_pdf');
  assert.equal(clean.workflow.final_state, 'READY');
  assert.equal(clean.workflow.typed_outputs.extraction.provider, 'tesseract-recorded-replay');
});

test("the scan workflow refuses another patient's document instead of throwing", async () => {
  const { run, traceSink } = serviceWithReplay();
  const result = await run('lab-a', 'lab_pdf', { requestPatient: 'fixture-patient-002' });
  assert.deepEqual(result, { status: 'blocked', reason: 'document_scope_mismatch' });
  assert.equal(traceSink.list().length, 0);
});

test('scan traces carry allowlisted handoff summaries, not typed lab values or dates', async () => {
  const { run, traceSink } = serviceWithReplay();
  const result = await run('lab-a', 'lab_pdf');
  assert.ok(result.workflow.handoffs[0].extraction.lab_results.length);
  const serialized = JSON.stringify(traceSink.list());
  for (const value of ['2026-09-20', '12.0-16.0', 'under 5.7', 'Test Patient One', '1980-04-12']) assert.ok(!serialized.includes(value), `trace leaked ${value}`);
  assert.deepEqual(Object.keys(traceSafeHandoff(result.workflow.handoffs[0])).sort(), ['citation_count', 'input_type', 'output_status', 'redacted_metrics', 'retry_count', 'step_names', 'worker']);
});

test('source preview never lists a low-confidence field as verified', () => {
  const citation = (quote) => ({ source_type: 'document', source_id: 'doc-1', page_or_section: 'page 1', field_or_chunk_id: 'x', quote_or_value: quote, bounding_box: [1, 2, 3, 4], coordinate_space: 'raster_pixels_200dpi' });
  const extraction = {
    status: 'complete',
    facts: [
      { field_id: 'lab.hgb.unit', value: 'g/dL', confidence: 0.95, citation: citation('Hemoglobin unit: g/dL'), uncertainty: null },
      { field_id: 'lab.hgb.value', value: '13.2', confidence: 0.78, citation: citation('Hemoglobin value: 13.2'), uncertainty: 'low_confidence_requires_human_review' },
    ],
    missing_fields: [], uncertain_fields: [{ field_id: 'lab.hgb.value', reason: 'low_confidence_requires_human_review' }], conflicts: [], metrics: { pages: 1 },
  };
  const html = renderScanSourcePreview({ sourceDocument: { id: 'doc-1', filename: 'lab.pdf' }, extraction });
  assert.match(html, /<strong>1<\/strong><span>verified fields<\/span>/);
  const verifiedSection = html.slice(html.indexOf('Verified field evidence'), html.indexOf('Low-confidence values'));
  assert.ok(!verifiedSection.includes('data-field-id="lab.hgb.value"'), 'low-confidence field rendered under verified evidence');
  assert.match(html.slice(html.indexOf('Low-confidence values')), /data-field-id="lab\.hgb\.value"/);
});

test('HTTP scan-supervisor answers 403 for a document owned by another patient', async () => {
  const port = 18821;
  const child = spawn(process.execPath, ['agentforge/src/server.js'], { cwd: fileURLToPath(new URL('../../', import.meta.url)), env: { ...process.env, PORT: String(port), AGENTFORGE_DEMO_SECRET: 'synthetic-test-secret', AGENTFORGE_SYNTHETIC_CONTEXT: 'true', AGENTFORGE_PROVIDER_MODE: 'deterministic' }, stdio: 'ignore' });
  try {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch { /* server still starting */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const base = `http://127.0.0.1:${port}`;
    const write = await fetch(`${base}/v1/source-document-context?patient_uuid=fixture-patient-001`).then((response) => response.json());
    const content = fs.readFileSync(new URL('../../docs/agentforge/fixtures/scan-forms/lab-layout-a-complete.scan.txt', import.meta.url));
    const upload = await fetch(`${base}/v1/source-documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: write.demo_token, document_type: 'lab_pdf', filename: 'lab.txt', content_base64: content.toString('base64') }) }).then((response) => response.json());
    const other = await fetch(`${base}/v1/demo-context?patient_uuid=fixture-patient-002`).then((response) => response.json());
    const response = await fetch(`${base}/v1/scan-supervisor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: 'fixture-patient-002', clinician_uuid: 'fixture-physician-001', demo_token: other.demo_token, source_document_id: upload.source_document.id, message: 'glycemic follow-up' }) });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'document_scope_mismatch' });
  } finally {
    child.kill();
  }
});
