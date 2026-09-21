import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SimulatedOpenEMRAdapter } from '../src/openemrAdapter.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';
import { AgentForgeService } from '../src/service.js';
import { renderAgentForgePage } from '../src/ui.js';
import { extractLabEvidence } from '../src/labEvidence.js';

const fixturePath = fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url));
const signedContext = (patient_uuid, clinician_uuid = 'fixture-physician-001') => ({
  patient_uuid,
  clinician_uuid,
  scope: 'read-briefing',
  issuer: 'synthetic-demo',
  authn: 'synthetic',
  role: 'clinician',
  acl: 'read',
  expires_at: Math.floor(Date.now() / 1000) + 300,
});

const verifiedWriteContext = (patient_uuid, clinician_uuid = 'fixture-physician-001') => verifySignedContext(issueSignedContext({ patient_uuid, clinician_uuid, scope: 'write-source-document', acl: 'write', secret: 'synthetic-test-secret' }), 'synthetic-test-secret');

test('synthetic OpenEMR source documents persist, read back, and deduplicate', async () => {
  const adapter = new SimulatedOpenEMRAdapter({ fixturePath });
  const content = Buffer.from('%PDF-1.7 synthetic lab fixture');
  const now = () => '2026-09-21T20:00:00.000Z';
  const request = {
    patientRef: 'fixture-patient-001',
    documentType: 'lab_pdf',
    filename: 'lab-results.pdf',
    content,
    uploadedBy: 'fixture-physician-001',
    now,
  };

  const first = await adapter.persistSourceDocument(request);
  assert.equal(first.duplicate, false);
  assert.equal(first.document.synthetic_only, true);
  assert.equal(first.document.patient_ref, 'fixture-patient-001');
  assert.equal(first.document.document_type, 'lab_pdf');
  assert.equal(first.document.filename, 'lab-results.pdf');
  assert.equal(first.document.ingestion_revision, 1);
  assert.equal(first.document.source_system, 'synthetic-roundtrip');
  assert.equal(first.document.persistence_boundary, 'simulated-openemr-adapter');
  assert.equal(first.document.uploaded_by, 'fixture-physician-001');
  assert.match(first.document.id, /^src-/);
  assert.match(first.document.content_sha256, /^[0-9a-f]{64}$/);

  const readback = await adapter.getSourceDocument(first.document.id, { patientRef: 'fixture-patient-001' });
  assert.equal(readback.document.id, first.document.id);
  assert.equal(readback.document.content_sha256, first.document.content_sha256);
  assert.deepEqual(readback.content, content);

  const retry = await adapter.persistSourceDocument(request);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.document.id, first.document.id);
  assert.equal((await adapter.listSourceDocuments('fixture-patient-001')).length, 1);
});

test('synthetic OpenEMR source documents fail closed across patient scope', async () => {
  const adapter = new SimulatedOpenEMRAdapter({ fixturePath });
  const { document } = await adapter.persistSourceDocument({
    patientRef: 'fixture-patient-001',
    documentType: 'intake_form',
    filename: 'intake.json',
    content: Buffer.from('{"synthetic":true}'),
    uploadedBy: 'fixture-physician-001',
  });

  assert.throws(() => adapter.getSourceDocument(document.id, { patientRef: 'fixture-patient-002' }), /DOCUMENT_SCOPE_MISMATCH/);
  assert.throws(() => adapter.getSourceDocument('src-does-not-exist', { patientRef: 'fixture-patient-001' }), /DOCUMENT_NOT_FOUND/);
});

test('synthetic source upload still requires a verified signed context at the adapter seam', () => {
  const adapter = new SimulatedOpenEMRAdapter({ fixturePath });
  assert.equal(adapter.authorize({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }, null).status, 'blocked');
  assert.equal(adapter.authorize({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }, signedContext('fixture-patient-001')).status, 'blocked');
});

test('synthetic source persistence reports failures and the service exposes the workflow result', () => {
  const failingAdapter = new SimulatedOpenEMRAdapter({ fixturePath, sourceDocumentStore: { persist() { throw Object.assign(new Error('SOURCE_DOCUMENT_PERSISTENCE_FAILED'), { code: 'SOURCE_DOCUMENT_PERSISTENCE_FAILED' }); } } });
  const service = new AgentForgeService({ adapter: failingAdapter });
  assert.throws(() => service.ingestSourceDocument({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', document_type: 'lab_pdf', filename: 'lab.pdf', content: Buffer.from('synthetic') }, { verifiedContext: verifiedWriteContext('fixture-patient-001') }), /SOURCE_DOCUMENT_PERSISTENCE_FAILED/);

  const adapter = new SimulatedOpenEMRAdapter({ fixturePath });
  const workflow = new AgentForgeService({ adapter });
  const result = workflow.ingestSourceDocument({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', document_type: 'intake_form', filename: 'intake.json', content: Buffer.from('{"synthetic":true}') }, { verifiedContext: verifiedWriteContext('fixture-patient-001') });
  assert.equal(result.status, 'persisted');
  assert.equal(result.synthetic_only, true);
  assert.equal(result.source_document.persistence_boundary, 'simulated-openemr-adapter');
});

test('AgentForge UI exposes the two synthetic source-document types and upload route', () => {
  const page = renderAgentForgePage({ token: 'synthetic-token', payload: { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' } });
  assert.match(page, /source-document-form/);
  assert.match(page, /value="lab_pdf"/);
  assert.match(page, /value="intake_form"/);
  assert.match(page, /\/v1\/source-documents/);
});

test('synthetic lab extraction preserves citations, qualifies gaps, and detects conflicts', () => {
  const content = Buffer.from('LAB|test=Hemoglobin|value=13.2|unit=g/dL|reference_range=12-16|collection_date=2026-09-20|abnormal=false|page=1|field_id=lab.hgb|quote=Hemoglobin 13.2 g/dL|bounding_box=10,20,100,40');
  const valid = extractLabEvidence({ sourceDocumentId: 'src-lab-1', content });
  assert.equal(valid.status, 'complete');
  assert.deepEqual(valid.facts[0].citation.bounding_box, [10, 20, 100, 40]);
  assert.equal(valid.facts[0].citation.source_document_id, 'src-lab-1');

  const missing = extractLabEvidence({ sourceDocumentId: 'src-lab-2', content: Buffer.from('LAB|test=Hemoglobin|value=13.2|unit=g/dL') });
  assert.equal(missing.status, 'qualified');
  assert.ok(missing.issues.some((value) => value.includes('missing_fields')));

  const conflict = extractLabEvidence({ sourceDocumentId: 'src-lab-3', content: Buffer.from(`${content.toString()}\nLAB|test=Hemoglobin|value=14.1|unit=g/dL|reference_range=12-16|collection_date=2026-09-20|abnormal=false|page=1|field_id=lab.hgb-2|quote=Hemoglobin 14.1 g/dL|bounding_box=10,50,100,70`) });
  assert.equal(conflict.status, 'qualified');
  assert.ok(conflict.issues.some((value) => value.includes('conflicting_values')));
});

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function startServer(port, extraEnv = {}, waitPath = '/ready') {
  const child = spawn(process.execPath, ['agentforge/src/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), AGENTFORGE_DEMO_SECRET: 'synthetic-test-secret', AGENTFORGE_SYNTHETIC_CONTEXT: 'true', ...extraEnv },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}${waitPath}`)).ok) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  child.kill();
  throw new Error('AgentForge test server did not become ready');
}

test('synthetic source document API uploads, deduplicates, reads back, and scopes records', async () => {
  const port = 18801;
  const child = await startServer(port);
  try {
    const context = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=fixture-patient-001`).then((response) => response.json());
    const writeContext = await fetch(`http://127.0.0.1:${port}/v1/source-document-context?patient_uuid=fixture-patient-001`).then((response) => response.json());
    const body = {
      patient_uuid: 'fixture-patient-001',
      clinician_uuid: 'fixture-physician-001',
      demo_token: writeContext.demo_token,
      document_type: 'lab_pdf',
      filename: 'lab-results.pdf',
      content_base64: Buffer.from('%PDF-1.7 synthetic API fixture').toString('base64'),
    };
    const firstResponse = await fetch(`http://127.0.0.1:${port}/v1/source-documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.equal(first.duplicate, false);
    assert.equal(first.synthetic_only, true);
    assert.equal(first.source_document.patient_ref, body.patient_uuid);
    assert.equal(first.source_document.document_type, body.document_type);
    assert.equal(Object.hasOwn(first.source_document, 'content_base64'), false);

    const retry = await fetch(`http://127.0.0.1:${port}/v1/source-documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((response) => response.json());
    assert.equal(retry.duplicate, true);
    assert.equal(retry.source_document.id, first.source_document.id);

    const readbackResponse = await fetch(`http://127.0.0.1:${port}/v1/source-documents/${first.source_document.id}?patient_uuid=fixture-patient-001&demo_token=${encodeURIComponent(context.demo_token)}`);
    assert.equal(readbackResponse.status, 200);
    const readback = await readbackResponse.json();
    assert.equal(readback.source_document.id, first.source_document.id);
    assert.equal(Buffer.from(readback.content_base64, 'base64').toString(), '%PDF-1.7 synthetic API fixture');

    const otherContext = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=fixture-patient-002`).then((response) => response.json());
    const crossPatient = await fetch(`http://127.0.0.1:${port}/v1/source-documents/${first.source_document.id}?patient_uuid=fixture-patient-002&demo_token=${encodeURIComponent(otherContext.demo_token)}`);
    assert.equal(crossPatient.status, 403);
    assert.equal((await crossPatient.json()).error, 'invalid_demo_context');
  } finally {
    child.kill();
  }
});

test('synthetic lab evidence API links derived observations to the source and deduplicates readback', async () => {
  const port = 18805;
  const child = await startServer(port);
  try {
    const patient = 'fixture-patient-001';
    const readContext = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=${patient}`).then((response) => response.json());
    const writeContext = await fetch(`http://127.0.0.1:${port}/v1/source-document-context?patient_uuid=${patient}`).then((response) => response.json());
    const content = 'LAB|test=Hemoglobin|value=13.2|unit=g/dL|reference_range=12-16|collection_date=2026-09-20|abnormal=false|page=1|field_id=lab.hgb|quote=Hemoglobin 13.2 g/dL|bounding_box=10,20,100,40';
    const upload = await fetch(`http://127.0.0.1:${port}/v1/source-documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', demo_token: writeContext.demo_token, document_type: 'lab_pdf', filename: 'synthetic-lab.pdf', content_base64: Buffer.from(content).toString('base64') }) }).then((response) => response.json());
    assert.ok(upload.source_document?.id);
    const path = `/v1/source-documents/${upload.source_document.id}/lab-evidence?patient_uuid=${patient}&demo_token=${encodeURIComponent(readContext.demo_token)}`;
    const firstResponse = await fetch(`http://127.0.0.1:${port}${path}`);
    assert.equal(firstResponse.status, 200);
    const first = await firstResponse.json();
    assert.equal(first.extraction.status, 'complete');
    assert.equal(first.extraction.facts[0].citation.source_document_id, upload.source_document.id);
    assert.equal(first.observations[0].observation.source_document_id, upload.source_document.id);
    const retry = await fetch(`http://127.0.0.1:${port}${path}`).then((response) => response.json());
    assert.equal(retry.observations[0].duplicate, true);
  } finally {
    child.kill();
  }
});

test('source document API rejects malformed input and live-mode writeback', async () => {
  const port = 18802;
  const child = await startServer(port);
  try {
    const context = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=fixture-patient-001`).then((response) => response.json());
    const writeContext = await fetch(`http://127.0.0.1:${port}/v1/source-document-context?patient_uuid=fixture-patient-001`).then((response) => response.json());
    const malformed = await fetch(`http://127.0.0.1:${port}/v1/source-documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: writeContext.demo_token, document_type: 'unsupported', filename: 'bad.txt', content_base64: 'aGVsbG8=' }) });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, 'invalid_source_document_request');
  } finally {
    child.kill();
  }

  const livePort = 18803;
  const liveChild = await startServer(livePort, { AGENTFORGE_OPENEMR_MODE: 'live', AGENTFORGE_OPENEMR_BASE_URL: 'http://openemr', AGENTFORGE_OPENEMR_ACCESS_TOKEN: '' }, '/health');
  try {
    const response = await fetch(`http://127.0.0.1:${livePort}/v1/source-documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: 'patient-uuid', clinician_uuid: 'clinician-uuid', demo_token: 'not-valid', document_type: 'lab_pdf', filename: 'lab.pdf', content_base64: 'aGVsbG8=' }) });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'synthetic_writeback_only');
  } finally {
    liveChild.kill();
  }

  const failurePort = 18804;
  const failureChild = await startServer(failurePort, { AGENTFORGE_TEST_SOURCE_DOCUMENT_FAILURE: 'true' });
  try {
    const writeContext = await fetch(`http://127.0.0.1:${failurePort}/v1/source-document-context?patient_uuid=fixture-patient-001`).then((response) => response.json());
    const response = await fetch(`http://127.0.0.1:${failurePort}/v1/source-documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: writeContext.demo_token, document_type: 'lab_pdf', filename: 'lab.pdf', content_base64: 'aGVsbG8=' }) });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, 'SOURCE_DOCUMENT_PERSISTENCE_FAILED');
  } finally {
    failureChild.kill();
  }
});
