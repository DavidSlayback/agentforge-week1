import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeOpenEMRModule } from './fake-openemr-module.js';
import { AgentForgeService } from '../src/service.js';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { DeterministicProvider } from '../src/modelProvider.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';
import { createOpenEMRModuleWritebackFromEnv } from '../src/openemrModuleWriteback.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const secret = 'synthetic-test-secret';
const moduleHmacSecret = 'synthetic-module-hmac-secret';
const openemrPatient = 'a2c37f7f-1076-4172-b17a-bee8bb8d2da6';

// The PDF-OCR tagged envelope the PDF lane produces, stored as a synthetic
// .scan.txt source (the local test host has no Tesseract).
const labEnvelope = [
  'SYNTHETIC_SCAN_FORM|layout=pdf-ocr-lab_pdf|page_count=1',
  ...[
    ['lab.hgb.test_name', 'Hemoglobin'], ['lab.hgb.value', '13.2'], ['lab.hgb.unit', 'g/dL'], ['lab.hgb.reference_range', '12.0-16.0'], ['lab.hgb.collection_date', '2026-09-20'], ['lab.hgb.abnormal', 'No'],
    ['lab.a1c.test_name', 'A1C'], ['lab.a1c.value', '6.1'], ['lab.a1c.unit', '%'], ['lab.a1c.reference_range', 'under 5.7'], ['lab.a1c.collection_date', '2026-09-20'], ['lab.a1c.abnormal', 'Yes'],
  ].map(([fieldId, value], index) => `FIELD|field_id=${fieldId}|label=${fieldId}|value=${value}|unit=|quote=${fieldId}: ${value}|page=1|box=10,${20 + index * 20},300,${35 + index * 20}|confidence=0.97`),
].join('\n');

async function startServer(port, extraEnv = {}) {
  const child = spawn(process.execPath, ['agentforge/src/server.js'], { cwd: root, env: { ...process.env, PORT: String(port), AGENTFORGE_DEMO_SECRET: secret, AGENTFORGE_SYNTHETIC_CONTEXT: 'true', AGENTFORGE_PROVIDER_MODE: 'deterministic', ...extraEnv }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return child; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  child.kill();
  throw new Error(`server did not start: ${stderr.slice(0, 500)}`);
}

async function contexts(base, patient) {
  const write = await fetch(`${base}/v1/source-document-context?patient_uuid=${patient}`).then((response) => response.json());
  const read = await fetch(`${base}/v1/demo-context?patient_uuid=${patient}`).then((response) => response.json());
  return { write: write.demo_token, read: read.demo_token, clinician: read.clinician_uuid };
}

const post = (base, route, body) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function uploadAndExtract(base, ctx, patient = 'fixture-patient-001', { scanToken = ctx.write } = {}) {
  const upload = await post(base, '/v1/source-documents', { patient_uuid: patient, clinician_uuid: ctx.clinician, demo_token: ctx.write, document_type: 'lab_pdf', filename: 'lab-ocr-envelope.scan.txt', content_base64: Buffer.from(labEnvelope).toString('base64') });
  const uploaded = await upload.json();
  if (upload.status !== 200) return { upload, uploaded };
  const scan = await post(base, '/v1/scan-supervisor', { patient_uuid: patient, clinician_uuid: ctx.clinician, demo_token: scanToken, source_document_id: uploaded.source_document.id, message: 'documented glycemic values' });
  return { upload, uploaded, scan, scanned: await scan.json() };
}

test('openemr-module persistence: upload stores the source in OpenEMR, extraction persists derived facts and lab rows, re-upload is idempotent', async () => {
  const fake = await startFakeOpenEMRModule({ hmacSecret: moduleHmacSecret, contextSecret: secret, allowlist: [openemrPatient] });
  const port = 18841;
  const child = await startServer(port, { AGENTFORGE_PERSISTENCE_MODE: 'openemr-module', AGENTFORGE_MODULE_HMAC_SECRET: moduleHmacSecret, AGENTFORGE_OPENEMR_MODULE_URL: fake.url, AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS: openemrPatient, AGENTFORGE_OPENEMR_DEMO_PATIENT_MAP: `fixture-patient-001=${openemrPatient}` });
  const base = `http://127.0.0.1:${port}`;
  try {
    const ctx = await contexts(base, 'fixture-patient-001');
    const first = await uploadAndExtract(base, ctx);
    assert.equal(first.upload.status, 200);
    assert.equal(first.uploaded.duplicate, false);
    assert.equal(first.uploaded.source_document.id, 'openemr-doc-57');
    assert.equal(first.uploaded.source_document.persistence_boundary, 'openemr-module');
    assert.equal(first.uploaded.openemr.document_id, 57);
    assert.equal(first.uploaded.openemr.patient_uuid, openemrPatient);
    assert.equal(first.scan.status, 200);
    const openemr = first.scanned.openemr;
    assert.equal(openemr.status, 'persisted');
    assert.equal(openemr.duplicate, false);
    assert.equal(openemr.document_id, 57);
    assert.equal(openemr.derived_document_id, 58);
    assert.equal(openemr.procedure_order_id, 9);
    assert.equal(openemr.observation_ids.length, 2);
    assert.equal(openemr.read_path, 'openemr-fhir-service-in-process');
    assert.equal(openemr.read_back.verified, true);
    assert.deepEqual(openemr.unmapped_lab_results, []);
    assert.equal(openemr.derived_payload_differs, false);
    assert.equal(openemr.lab_payload_differs, false);
    const afterFirst = fake.counts();
    assert.deepEqual([afterFirst.documents, afterFirst.procedure_orders, afterFirst.procedure_results], [2, 1, 2]);

    const second = await uploadAndExtract(base, ctx);
    assert.equal(second.uploaded.duplicate, true);
    assert.equal(second.uploaded.source_document.id, 'openemr-doc-57');
    assert.equal(second.scanned.openemr.duplicate, true);
    for (const field of ['document_id', 'derived_document_id', 'procedure_order_id']) assert.equal(second.scanned.openemr[field], openemr[field], field);
    assert.deepEqual(second.scanned.openemr.observation_ids, openemr.observation_ids);
    const afterSecond = fake.counts();
    assert.deepEqual([afterSecond.documents, afterSecond.procedure_orders, afterSecond.procedure_results], [2, 1, 2], 're-upload adds zero rows');
    assert.equal(afterSecond.rejected, 0, 'every module request was correctly signed');

    const bundle = await fetch(`${base}/v1/source-documents/openemr-doc-57/openemr-observations?patient_uuid=fixture-patient-001&demo_token=${encodeURIComponent(ctx.read)}`).then((response) => response.json());
    assert.equal(bundle.read_path, 'openemr-fhir-service-in-process');
    const byCode = Object.fromEntries(bundle.entry.map(({ resource }) => [resource.code.coding[0].code, resource.valueQuantity.value]));
    assert.deepEqual(byCode, { '718-7': 13.2, '4548-4': 6.1 });

    const unmappedCtx = await contexts(base, 'fixture-patient-002');
    const blocked = await uploadAndExtract(base, unmappedCtx, 'fixture-patient-002');
    assert.equal(blocked.upload.status, 403);
    assert.equal(blocked.uploaded.error, 'OPENEMR_DEMO_PATIENT_NOT_ALLOWED');

    // PNG bytes are rejected at the contract boundary (neither a PDF nor a
    // .scan.txt envelope) before the request ever reaches the OpenEMR module
    // writeback's own type check.
    const binary = await post(base, '/v1/source-documents', { patient_uuid: 'fixture-patient-001', clinician_uuid: ctx.clinician, demo_token: ctx.write, document_type: 'lab_pdf', filename: 'lab.png', content_base64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1]).toString('base64') });
    assert.equal(binary.status, 400);
    const binaryBody = await binary.json();
    assert.equal(binaryBody.error, 'invalid_source_document_request');
    assert.ok(binaryBody.issues.includes('unsupported_upload_format'));
  } finally {
    child.kill();
    await fake.close();
  }
});

test('openemr-module persistence fails loudly when the module is unreachable', async () => {
  const port = 18842;
  const child = await startServer(port, { AGENTFORGE_PERSISTENCE_MODE: 'openemr-module', AGENTFORGE_MODULE_HMAC_SECRET: moduleHmacSecret, AGENTFORGE_OPENEMR_MODULE_URL: 'http://127.0.0.1:9/api.php', AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS: openemrPatient, AGENTFORGE_OPENEMR_DEMO_PATIENT_MAP: `fixture-patient-001=${openemrPatient}` });
  const base = `http://127.0.0.1:${port}`;
  try {
    const ctx = await contexts(base, 'fixture-patient-001');
    const { upload, uploaded } = await uploadAndExtract(base, ctx);
    assert.equal(upload.status, 502);
    assert.equal(uploaded.error, 'OPENEMR_MODULE_UNREACHABLE');
  } finally {
    child.kill();
  }
});

test('in-memory synthetic mode is labelled as such and never claims OpenEMR persistence', async () => {
  const port = 18843;
  const child = await startServer(port);
  const base = `http://127.0.0.1:${port}`;
  try {
    const ctx = await contexts(base, 'fixture-patient-001');
    const { upload, uploaded, scan, scanned } = await uploadAndExtract(base, ctx);
    assert.equal(upload.status, 200);
    assert.equal(uploaded.source_document.persistence_boundary, 'in-memory-synthetic');
    assert.equal(uploaded.source_document.source_system, 'agentforge-in-memory');
    assert.equal('openemr' in uploaded, false);
    assert.equal(scan.status, 200);
    assert.equal('openemr' in scanned, false);
    assert.doesNotMatch(JSON.stringify(uploaded), /openemr/i);
  } finally {
    child.kill();
  }
});

test('fixture-mode briefings label their read as the synthetic fixture, not OpenEMR', async () => {
  const service = new AgentForgeService({ chartAdapter: new FixtureAdapter(path.join(root, 'docs/agentforge/fixtures/clinical-cases.json')), writeback: null, provider: new DeterministicProvider() });
  const verifiedContext = verifySignedContext(issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', secret }), secret);
  const briefing = await service.prepare({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }, { verifiedContext });
  assert.deepEqual(briefing.operations, [{ type: 'read', operation: 'retrieve_synthetic_fixture_read' }]);
});

const moduleEnv = (url) => ({ AGENTFORGE_PERSISTENCE_MODE: 'openemr-module', AGENTFORGE_MODULE_HMAC_SECRET: moduleHmacSecret, AGENTFORGE_OPENEMR_MODULE_URL: url, AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS: openemrPatient, AGENTFORGE_OPENEMR_DEMO_PATIENT_MAP: `fixture-patient-001=${openemrPatient}` });

test('a read-scope token never writes derived facts: the response says persistence was not authorized', async () => {
  const fake = await startFakeOpenEMRModule({ hmacSecret: moduleHmacSecret, contextSecret: secret, allowlist: [openemrPatient] });
  const port = 18844;
  const child = await startServer(port, moduleEnv(fake.url));
  const base = `http://127.0.0.1:${port}`;
  try {
    const ctx = await contexts(base, 'fixture-patient-001');
    const { scan, scanned } = await uploadAndExtract(base, ctx, 'fixture-patient-001', { scanToken: ctx.read });
    assert.equal(scan.status, 200);
    assert.equal(scanned.openemr.status, 'not_persisted');
    assert.equal(scanned.openemr.reason, 'persistence_not_authorized');
    assert.equal('derived_document_id' in scanned.openemr, false);
    const counts = fake.counts();
    assert.deepEqual([counts.documents, counts.procedure_orders, counts.procedure_results], [1, 0, 0], 'only the source upload (write token) was stored');
  } finally {
    child.kill();
    await fake.close();
  }
});

test('a failed OpenEMR read-back fails the request loudly (502), never a silent success', async () => {
  const fake = await startFakeOpenEMRModule({ hmacSecret: moduleHmacSecret, contextSecret: secret, allowlist: [openemrPatient] });
  fake.settings.corruptObservationValues = true;
  const port = 18845;
  const child = await startServer(port, moduleEnv(fake.url));
  const base = `http://127.0.0.1:${port}`;
  try {
    const ctx = await contexts(base, 'fixture-patient-001');
    const { scan, scanned } = await uploadAndExtract(base, ctx);
    assert.equal(scan.status, 502);
    assert.equal(scanned.error, 'openemr_observation_readback_mismatch');
    assert.equal('openemr' in scanned, false);
  } finally {
    child.kill();
    await fake.close();
  }
});

test('a different payload on an existing key is reported as payload_differs, not as a plain duplicate', async () => {
  const fake = await startFakeOpenEMRModule({ hmacSecret: moduleHmacSecret, contextSecret: secret, allowlist: [openemrPatient] });
  try {
    const writeback = createOpenEMRModuleWritebackFromEnv({ ...moduleEnv(fake.url), AGENTFORGE_DEMO_SECRET: secret });
    const context = verifySignedContext(issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', scope: 'write-source-document', acl: 'write', secret }), secret);
    const { document } = await writeback.persistSourceDocument({ patientRef: 'fixture-patient-001', documentType: 'intake_form', filename: 'intake.scan.txt', content: Buffer.from('SYNTHETIC_SCAN_FORM|layout=intake-a\n'), uploadedBy: 'fixture-physician-001', verifiedContext: context });
    const citation = { source_type: 'document', source_id: document.id, page_or_section: 'page 1', field_or_chunk_id: 'chief_concern', quote_or_value: 'x', bounding_box: [1, 2, 3, 4] };
    const extraction = (value) => ({ contract_version: 'w2-scan-v1', provider: 'test', status: 'complete', facts: [{ field_id: 'chief_concern', value, confidence: 0.9, citation }], lab_results: [], intake_form: null });
    const first = await writeback.persistDerivedEvidence({ patientRef: 'fixture-patient-001', sourceDocument: document, extraction: extraction('Fatigue'), verifiedContext: context });
    const second = await writeback.persistDerivedEvidence({ patientRef: 'fixture-patient-001', sourceDocument: document, extraction: extraction('Dizziness'), verifiedContext: context });
    assert.equal(first.derived_payload_differs, false);
    assert.equal(second.duplicate, true);
    assert.equal(second.derived_document_id, first.derived_document_id);
    assert.equal(second.derived_payload_differs, true);
    assert.throws(() => createOpenEMRModuleWritebackFromEnv({ ...moduleEnv(fake.url), AGENTFORGE_DEMO_SECRET: secret, AGENTFORGE_MODULE_HMAC_SECRET: secret }), /OPENEMR_MODULE_HMAC_SECRET_REQUIRED/);
    assert.throws(() => createOpenEMRModuleWritebackFromEnv({ ...moduleEnv(fake.url), AGENTFORGE_DEMO_SECRET: secret, AGENTFORGE_MODULE_HMAC_SECRET: '' }), /OPENEMR_MODULE_HMAC_SECRET_REQUIRED/);
  } finally {
    await fake.close();
  }
});
