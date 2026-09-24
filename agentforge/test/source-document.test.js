import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SimulatedOpenEMRAdapter } from '../src/openemrAdapter.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';
import { AgentForgeService } from '../src/service.js';
import { renderAgentForgePage } from '../src/ui.js';
import { startTestServer } from './helpers/testServer.js';

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

test('simulated synthetic source documents persist, read back, and deduplicate', async () => {
  const adapter = new SimulatedOpenEMRAdapter({ fixturePath });
  const content = Buffer.from('LAB|synthetic lab fixture text');
  const now = () => '2026-09-21T20:00:00.000Z';
  const request = {
    patientRef: 'fixture-patient-001',
    documentType: 'lab_pdf',
    filename: 'lab-results.txt',
    content,
    uploadedBy: 'fixture-physician-001',
    now,
  };

  const first = await adapter.persistSourceDocument(request);
  assert.equal(first.duplicate, false);
  assert.equal(first.document.synthetic_only, true);
  assert.equal(first.document.patient_ref, 'fixture-patient-001');
  assert.equal(first.document.document_type, 'lab_pdf');
  assert.equal(first.document.filename, 'lab-results.txt');
  assert.equal(first.document.ingestion_revision, 1);
  assert.equal(first.document.source_system, 'agentforge-in-memory');
  assert.equal(first.document.persistence_boundary, 'in-memory-synthetic');
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

test('simulated synthetic source documents fail closed across patient scope', async () => {
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

test('synthetic source persistence reports failures and the service exposes the workflow result', async () => {
  const failingAdapter = new SimulatedOpenEMRAdapter({ fixturePath, sourceDocumentStore: { persist() { throw Object.assign(new Error('SOURCE_DOCUMENT_PERSISTENCE_FAILED'), { code: 'SOURCE_DOCUMENT_PERSISTENCE_FAILED' }); } } });
  const service = new AgentForgeService({ adapter: failingAdapter });
  await assert.rejects(() => service.ingestSourceDocument({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', document_type: 'lab_pdf', filename: 'lab.pdf', content: Buffer.from('synthetic') }, { verifiedContext: verifiedWriteContext('fixture-patient-001') }), /SOURCE_DOCUMENT_PERSISTENCE_FAILED/);

  const adapter = new SimulatedOpenEMRAdapter({ fixturePath });
  const workflow = new AgentForgeService({ adapter });
  const result = await workflow.ingestSourceDocument({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', document_type: 'intake_form', filename: 'intake.json', content: Buffer.from('{"synthetic":true}') }, { verifiedContext: verifiedWriteContext('fixture-patient-001') });
  assert.equal(result.status, 'persisted');
  assert.equal(result.synthetic_only, true);
  assert.equal(result.source_document.persistence_boundary, 'in-memory-synthetic');
});

test('AgentForge UI exposes the two synthetic source-document types and upload route', () => {
  const page = renderAgentForgePage({ token: 'synthetic-token', payload: { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' } });
  assert.match(page, /source-document-form/);
  assert.match(page, /value="lab_pdf"/);
  assert.match(page, /value="intake_form"/);
  assert.match(page, /\/v1\/source-documents/);
  assert.match(page, /Completed synthetic PDF samples/);
  assert.match(page, /data-run-pdf-sample="lab-a"/);
  for (const sample of ['lab-a', 'lab-b', 'intake-a', 'intake-b']) assert.match(page, new RegExp(`/v1/demo-scan-pdf\\?sample=${sample}`));
  assert.match(page, /https:\/\/www\.fda\.gov\/media\/76299\/download/);
  assert.match(page, /Upload a synthetic filled lab PDF or a \.scan\.txt envelope/);
  assert.match(page, /Local OCR \(for a PDF\) returns cited page regions/);
});

test('AgentForge UI accepts only PDF and .scan.txt uploads, not plain .txt', () => {
  const page = renderAgentForgePage({ token: 'synthetic-token', payload: { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' } });
  const inputMatch = page.match(/<input type="file" name="source_file" accept="([^"]+)"/);
  assert.ok(inputMatch, 'source_file input must declare an accept attribute');
  const accepted = inputMatch[1].split(',');
  assert.deepEqual(accepted, ['.pdf', 'application/pdf', '.scan.txt']);
  assert.doesNotMatch(page, /accept="[^"]*\.txt,text\/plain/);
});

test('synthetic scan demo fixture route serves only the tracked sample with an explicit synthetic marker', async () => {
  const port = 18808;
  const child = await startServer(port);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/demo-scan-fixture`);
    assert.equal(response.status, 200);
    const sample = await response.json();
    assert.equal(sample.synthetic_only, true);
    assert.equal(sample.document_type, 'lab_pdf');
    assert.match(Buffer.from(sample.content_base64, 'base64').toString('utf8'), /^SYNTHETIC_SCAN_FORM\|layout=lab-a/);
  } finally {
    child.kill();
  }
});

test('synthetic PDF sample route serves only the four fixed completed form samples', async () => {
  const port = 18809;
  const child = await startServer(port);
  try {
    for (const sample of ['lab-a', 'lab-b', 'intake-a', 'intake-b']) {
      const response = await fetch(`http://127.0.0.1:${port}/v1/demo-scan-pdf?sample=${sample}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'application/pdf');
      assert.equal(response.headers.get('x-agentforge-synthetic'), 'true');
      assert.ok(Buffer.from(await response.arrayBuffer()).subarray(0, 5).equals(Buffer.from('%PDF-')));
    }
    assert.equal((await fetch(`http://127.0.0.1:${port}/v1/demo-scan-pdf?sample=../../.env`)).status, 400);
  } finally {
    child.kill();
  }
});

test('AgentForge UI keeps the isolated W2 public path for links and API calls', () => {
  const page = renderAgentForgePage({ publicBasePath: '/agentforge-w2' });
  assert.match(page, /href="\/agentforge-w2\/observability"/);
  assert.match(page, /location\.pathname\.startsWith\('\/agentforge-w2'\) \? '\/agentforge-w2' : location\.pathname\.startsWith\('\/agentforge'\) \? '\/agentforge' : ''/);
});

test('UI runs the scan supervisor with the write context so derived facts can persist', () => {
  const page = renderAgentForgePage({ publicBasePath: '/agentforge-w2' });
  const call = page.slice(page.indexOf("request('/v1/scan-supervisor'"));
  assert.match(call.slice(0, call.indexOf('});')), /demo_token: writeContext\.demo_token/);
});

// The unit tests that lived here for the legacy `extractLabEvidence`/
// `extractIntakeEvidence` LAB|/INTAKE| parsers were removed with those
// parsers (R2, issue #4). The surviving `.scan.txt` extraction path's
// equivalent missing/conflicting-field qualification is covered by
// scan-form.test.js ("scan-form adapter qualifies missing, unreadable, and
// conflicting values"), and its citation-schema validity is covered by
// schemas.test.js ("`.scan.txt` lab and intake extraction produce citations
// that validate against the Citation schema").

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const startServer = (port, extraEnv = {}, waitPath = '/ready') => startTestServer(port, extraEnv, { path: waitPath });

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

test('the retired legacy lab-evidence, intake-evidence and supervisor routes now return 404', async () => {
  const port = 18805;
  const child = await startServer(port);
  try {
    const patient = 'fixture-patient-001';
    const writeContext = await fetch(`http://127.0.0.1:${port}/v1/source-document-context?patient_uuid=${patient}`).then((response) => response.json());
    const content = fs.readFileSync(fileURLToPath(new URL('../../docs/agentforge/fixtures/scan-forms/lab-layout-a-complete.scan.txt', import.meta.url)));
    const upload = await fetch(`http://127.0.0.1:${port}/v1/source-documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', demo_token: writeContext.demo_token, document_type: 'lab_pdf', filename: 'synthetic-lab.scan.txt', content_base64: content.toString('base64') }) }).then((response) => response.json());
    assert.ok(upload.source_document?.id);

    // These two URLs now fall through to the generic
    // `/v1/source-documents/:id` reader (there is no `/lab-evidence` or
    // `/intake-evidence` route left to match first), which reports a 404
    // because "id/lab-evidence" is not a stored document id — still a 404,
    // just with that reader's own not-found body rather than the server's
    // generic `not_found` fallback.
    const labEvidence = await fetch(`http://127.0.0.1:${port}/v1/source-documents/${upload.source_document.id}/lab-evidence?patient_uuid=${patient}&demo_token=${encodeURIComponent(writeContext.demo_token)}`);
    assert.equal(labEvidence.status, 404);
    assert.equal((await labEvidence.json()).error, 'DOCUMENT_NOT_FOUND');

    const intakeEvidence = await fetch(`http://127.0.0.1:${port}/v1/source-documents/${upload.source_document.id}/intake-evidence?patient_uuid=${patient}&demo_token=${encodeURIComponent(writeContext.demo_token)}`);
    assert.equal(intakeEvidence.status, 404);
    assert.equal((await intakeEvidence.json()).error, 'DOCUMENT_NOT_FOUND');

    const supervisor = await fetch(`http://127.0.0.1:${port}/v1/supervisor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', message: 'anything', demo_token: writeContext.demo_token }) });
    assert.equal(supervisor.status, 404);
    assert.equal((await supervisor.json()).error, 'not_found');
  } finally {
    child.kill();
  }
});

test('synthetic scan-form evidence API and source preview preserve page-region citations', async () => {
  const port = 18807;
  const child = await startServer(port);
  try {
    const patient = 'fixture-patient-001';
    const readContext = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=${patient}`).then((response) => response.json());
    const writeContext = await fetch(`http://127.0.0.1:${port}/v1/source-document-context?patient_uuid=${patient}`).then((response) => response.json());
    const content = fs.readFileSync(fileURLToPath(new URL('../../docs/agentforge/fixtures/scan-forms/lab-layout-a-complete.scan.txt', import.meta.url)));
    const upload = await fetch(`http://127.0.0.1:${port}/v1/source-documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', demo_token: writeContext.demo_token, document_type: 'lab_pdf', filename: 'lab-layout-a.pdf', content_base64: content.toString('base64') }) }).then((response) => response.json());
    const evidencePath = `/v1/source-documents/${upload.source_document.id}/scan-form-evidence?patient_uuid=${patient}&demo_token=${encodeURIComponent(readContext.demo_token)}`;
    const evidenceResponse = await fetch(`http://127.0.0.1:${port}${evidencePath}`);
    assert.equal(evidenceResponse.status, 200);
    const evidence = await evidenceResponse.json();
    // This fixture's flat `lab.hgb`/`lab.a1c` ids (no PDF-OCR field
    // suffixes) cannot be typed into a LabResult (no collection_date or
    // abnormal_flag data exists in this layout), so the general "no fact is
    // silently dropped from the typed view" rule records a typed_issue per
    // field and downgrades status from `complete` to `qualified`.
    assert.equal(evidence.extraction.status, 'qualified');
    assert.equal(evidence.extraction.lab_results.length, 0);
    assert.ok(evidence.extraction.typed_issues.includes('fact_not_mapped_to_typed_output:lab.hgb'));
    assert.equal(evidence.source_preview[0].source_id, upload.source_document.id);
    assert.deepEqual(evidence.source_preview[0].bounding_box, [72, 126, 246, 150]);
    const preview = await fetch(`http://127.0.0.1:${port}/v1/source-documents/${upload.source_document.id}/source-preview?patient_uuid=${patient}&demo_token=${encodeURIComponent(readContext.demo_token)}`).then((response) => response.text());
    assert.match(preview, /Synthetic source preview/);
    assert.match(preview, /data-bounding-box="72,126,246,150"/);
    const workflow = await fetch(`http://127.0.0.1:${port}/v1/scan-supervisor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', demo_token: readContext.demo_token, source_document_id: upload.source_document.id, message: 'documented glycemic values medication adherence' }) });
    assert.equal(workflow.status, 200);
    const workflowBody = await workflow.json();
    assert.equal(workflowBody.workflow.handoffs[0].worker, 'scan-form-extraction-worker');
    assert.equal(workflowBody.workflow.handoffs[1].worker, 'evidence-retrieval-worker');
    // The untypeable flat fixture ids make the extraction `qualified`, so the workflow is QUALIFIED, not READY.
    assert.equal(workflowBody.workflow.final_state, 'QUALIFIED');
    assert.ok(workflowBody.workflow.qualification.reasons.includes('extraction_incomplete'));
  } finally {
    child.kill();
  }
});

test('scan extraction responses are re-validated at the HTTP boundary and never sent unvalidated', async () => {
  const port = 18809;
  const child = await startServer(port, { AGENTFORGE_TEST_INVALID_SCAN_EXTRACTION: 'true' });
  try {
    const patient = 'fixture-patient-001';
    const readContext = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=${patient}`).then((response) => response.json());
    const writeContext = await fetch(`http://127.0.0.1:${port}/v1/source-document-context?patient_uuid=${patient}`).then((response) => response.json());
    const content = fs.readFileSync(fileURLToPath(new URL('../../docs/agentforge/fixtures/scan-forms/lab-layout-a-complete.scan.txt', import.meta.url)));
    const upload = await fetch(`http://127.0.0.1:${port}/v1/source-documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', demo_token: writeContext.demo_token, document_type: 'lab_pdf', filename: 'lab-layout-a.pdf', content_base64: content.toString('base64') }) }).then((response) => response.json());
    const evidencePath = `/v1/source-documents/${upload.source_document.id}/scan-form-evidence?patient_uuid=${patient}&demo_token=${encodeURIComponent(readContext.demo_token)}`;
    const evidenceResponse = await fetch(`http://127.0.0.1:${port}${evidencePath}`);
    assert.equal(evidenceResponse.status, 500);
    assert.deepEqual(await evidenceResponse.json(), { error: 'response_contract_invalid' });
    const workflowResponse = await fetch(`http://127.0.0.1:${port}/v1/scan-supervisor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', demo_token: readContext.demo_token, source_document_id: upload.source_document.id, message: 'documented glycemic values medication adherence' }) });
    assert.equal(workflowResponse.status, 500);
    assert.deepEqual(await workflowResponse.json(), { error: 'response_contract_invalid' });
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
    const response = await fetch(`http://127.0.0.1:${failurePort}/v1/source-documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: writeContext.demo_token, document_type: 'lab_pdf', filename: 'lab.pdf', content_base64: Buffer.from('%PDF-1.7 synthetic').toString('base64') }) });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, 'SOURCE_DOCUMENT_PERSISTENCE_FAILED');
  } finally {
    failureChild.kill();
  }
});
