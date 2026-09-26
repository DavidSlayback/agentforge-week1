import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import { startFakeOpenEMRModule } from './fake-openemr-module.js';
import { startFakeOpenEMRRest, LIVE_PATIENT, OTHER_PATIENT } from './helpers/fakeOpenemrRest.js';
import { startTestServer } from './helpers/testServer.js';
import { issueSignedContext } from '../src/accessContext.js';

// E9 over HTTP: server.js in the W2 shape (synthetic mode, module persistence)
// with AGENTFORGE_OPENEMR_LIVE_READS on or off, a fake OpenEMR REST API and a
// fake oe-module-agentforge. Module-session tokens are minted here the way the
// PHP launcher mints them (issuer openemr-module, authn openemr-session).
const secret = 'synthetic-test-secret';
const moduleHmacSecret = 'synthetic-module-hmac-secret';
const clinician = '6f1e2d3c-4b5a-4968-8776-655443322110';
const moduleToken = (patient, scope = 'read-briefing') => issueSignedContext({ patient_uuid: patient, clinician_uuid: clinician, scope, acl: scope === 'read-briefing' ? 'read' : 'write', issuer: 'openemr-module', authn: 'openemr-session', secret });
const labEnvelope = [
  'SYNTHETIC_SCAN_FORM|layout=pdf-ocr-lab_pdf|page_count=1',
  ...[
    ['lab.hgb.test_name', 'Hemoglobin'], ['lab.hgb.value', '13.2'], ['lab.hgb.unit', 'g/dL'], ['lab.hgb.reference_range', '12.0-16.0'], ['lab.hgb.collection_date', '2026-09-20'], ['lab.hgb.abnormal', 'No'],
    ['lab.a1c.test_name', 'A1C'], ['lab.a1c.value', '6.1'], ['lab.a1c.unit', '%'], ['lab.a1c.reference_range', 'under 5.7'], ['lab.a1c.collection_date', '2026-09-20'], ['lab.a1c.abnormal', 'Yes'],
  ].map(([fieldId, value], index) => `FIELD|field_id=${fieldId}|label=${fieldId}|value=${value}|unit=|quote=${fieldId}: ${value}|page=1|box=10,${20 + index * 20},300,${35 + index * 20}|confidence=0.97`),
].join('\n');
const post = (base, route, body) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/**
 * TEST-ONLY recording stand-in for every external model endpoint (the Qwen
 * answer/rerank lane and the OpenRouter critic lane). It answers 503, so the
 * service falls back, and records each request so a test can prove whether
 * anything left the process.
 */
async function startRecordingModelServer() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url, bytes: body.length });
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end('{"error":"recording stand-in"}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function startStack(port, liveReads, extraEnv = {}) {
  const rest = await startFakeOpenEMRRest();
  const module = await startFakeOpenEMRModule({ hmacSecret: moduleHmacSecret, contextSecret: secret, allowlist: [LIVE_PATIENT] });
  const child = await startTestServer(port, {
    AGENTFORGE_PROVIDER_MODE: 'deterministic',
    AGENTFORGE_OPENEMR_LIVE_READS: liveReads,
    AGENTFORGE_OPENEMR_BASE_URL: rest.url,
    AGENTFORGE_OPENEMR_ACCESS_TOKEN: 'synthetic-token',
    AGENTFORGE_PERSISTENCE_MODE: 'openemr-module',
    AGENTFORGE_MODULE_HMAC_SECRET: moduleHmacSecret,
    AGENTFORGE_OPENEMR_MODULE_URL: module.url,
    AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS: LIVE_PATIENT,
    AGENTFORGE_OPENEMR_DEMO_PATIENT_MAP: '',
    AGENTFORGE_TRACE_PATH: path.join(mkdtempSync(path.join(os.tmpdir(), 'agentforge-e9-')), 'traces.json'),
    ...extraEnv,
  }, { path: '/health' });
  const base = `http://127.0.0.1:${port}`;
  return { base, rest, module, stop: async () => { child.kill(); await rest.close(); await module.close(); } };
}

async function uploadAndScan(base, writeToken, patient = LIVE_PATIENT) {
  const upload = await post(base, '/v1/source-documents', { patient_uuid: patient, clinician_uuid: clinician, demo_token: writeToken, document_type: 'lab_pdf', filename: 'lab-ocr-envelope.scan.txt', content_base64: Buffer.from(labEnvelope).toString('base64') });
  const uploaded = await upload.json();
  if (upload.status !== 200) return { upload, uploaded };
  const scan = await post(base, '/v1/scan-supervisor', { patient_uuid: patient, clinician_uuid: clinician, demo_token: writeToken, source_document_id: uploaded.source_document.id, message: '' });
  return { upload, uploaded, scan, scanned: await scan.json() };
}

test('live reads on: a module session reads the OpenEMR chart over REST, labels it, and drops other-patient rows', async () => {
  const stack = await startStack(18971, 'on');
  const { base, rest } = stack;
  try {
    const read = moduleToken(LIVE_PATIENT);
    const write = moduleToken(LIVE_PATIENT, 'write-source-document');

    const page = await (await fetch(`${base}/?demo_token=${encodeURIComponent(read)}&write_token=${encodeURIComponent(write)}`)).text();
    assert.match(page, /Chart source: OpenEMR \(live\)/);
    assert.ok(page.includes(`writeToken: ${JSON.stringify(write)}`), 'the launcher write token reaches the page');
    const otherWrite = moduleToken(OTHER_PATIENT, 'write-source-document');
    const mismatched = await (await fetch(`${base}/?demo_token=${encodeURIComponent(read)}&write_token=${encodeURIComponent(otherWrite)}`)).text();
    assert.match(mismatched, /writeToken: ""/, 'a write token for another patient is not accepted');

    const briefing = await (await post(base, '/v1/briefings', { patient_uuid: LIVE_PATIENT, clinician_uuid: clinician, demo_token: read })).json();
    assert.deepEqual(briefing.operations, [{ type: 'read', operation: 'retrieve_openemr_read' }]);
    assert.ok(briefing.claims.some((claim) => claim.field === 'encounter.reason' && claim.value === 'blood-pressure follow-up'));
    assert.equal(JSON.stringify(briefing).includes('LEAKED'), false);

    const { upload, uploaded, scan, scanned } = await uploadAndScan(base, write);
    assert.equal(upload.status, 200);
    assert.equal(uploaded.openemr.patient_uuid, LIVE_PATIENT);
    assert.equal(scan.status, 200);
    assert.deepEqual({ chart_source: scanned.chart_source.chart_source, label: scanned.chart_source.label, status: scanned.chart_source.status }, { chart_source: 'openemr_live', label: 'OpenEMR (live)', status: 'read' });
    const chartCitations = scanned.workflow.answer.patient_facts.flatMap((claim) => claim.citations).filter((citation) => citation.source_type !== 'document');
    assert.ok(chartCitations.length >= 4, 'chart facts reach the answer');
    assert.ok(chartCitations.every((citation) => citation.source_type === 'openemr_record'));
    assert.equal(JSON.stringify(scanned).includes('LEAKED'), false);

    const evidence = await (await post(base, '/v1/follow-up-evidence', { patient_uuid: LIVE_PATIENT, clinician_uuid: clinician, demo_token: read, message: 'blood pressure' })).json();
    assert.equal(evidence.retrieval.chart_source, 'openemr_live');
    assert.ok(evidence.patient_facts.every((fact) => fact.citation.source_type === 'openemr_record'));

    const chartRequests = rest.requests.filter((request) => request.path.startsWith('/apis/default/api/patient/'));
    assert.ok(chartRequests.length > 0 && chartRequests.every((request) => request.method === 'GET' && request.authorization === 'Bearer synthetic-token'));

    const traces = await (await fetch(`${base}/v1/traces`)).json();
    const chartAttempts = (trace) => trace.retrieval.attempts.filter((attempt) => 'adapter' in attempt);
    const scanTrace = traces.find((trace) => trace.operation === 'w2-scan-supervisor');
    assert.ok(chartAttempts(scanTrace).length > 0 && chartAttempts(scanTrace).every((attempt) => attempt.adapter === 'openemr'));
    const briefingTrace = traces.find((trace) => trace.operation === 'visit_briefing');
    assert.ok(chartAttempts(briefingTrace).length > 0 && chartAttempts(briefingTrace).every((attempt) => attempt.adapter === 'openemr'));
  } finally { await stack.stop(); }
});

test('live reads on: the public demo stays on fixtures, and tampered or non-allowlisted module tokens are refused', async () => {
  const stack = await startStack(18972, 'on');
  const { base, rest, module } = stack;
  try {
    const demo = await (await fetch(`${base}/v1/demo-context?patient_uuid=fixture-patient-001`)).json();
    // Body fields cannot even name a chart source: the request contract refuses them.
    const spoofed = await post(base, '/v1/briefings', { patient_uuid: 'fixture-patient-001', clinician_uuid: demo.clinician_uuid, demo_token: demo.demo_token, chart_source: 'openemr_live' });
    assert.equal(spoofed.status, 400);
    assert.deepEqual((await spoofed.json()).issues, ['chart_source_is_not_in_contract']);
    const briefing = await (await post(base, '/v1/briefings', { patient_uuid: 'fixture-patient-001', clinician_uuid: demo.clinician_uuid, demo_token: demo.demo_token })).json();
    assert.deepEqual(briefing.operations, [{ type: 'read', operation: 'retrieve_synthetic_fixture_read' }]);
    assert.equal(rest.requests.filter((request) => request.path.startsWith('/apis/default/api/patient/')).length, 0, 'a synthetic token never reaches OpenEMR');

    const read = moduleToken(LIVE_PATIENT);
    const [encoded, signature] = read.split('.');
    const tampered = `${Buffer.from(Buffer.from(encoded, 'base64url').toString('utf8').replace(LIVE_PATIENT, OTHER_PATIENT)).toString('base64url')}.${signature}`;
    const refused = await post(base, '/v1/briefings', { patient_uuid: OTHER_PATIENT, clinician_uuid: clinician, demo_token: tampered });
    assert.equal(refused.status, 403);

    const before = module.counts().documents;
    const { upload, uploaded } = await uploadAndScan(base, moduleToken(OTHER_PATIENT, 'write-source-document'), OTHER_PATIENT);
    assert.equal(upload.status, 403);
    assert.equal(uploaded.error, 'OPENEMR_DEMO_PATIENT_NOT_ALLOWED');
    assert.equal(module.counts().documents, before, 'no write for a non-allowlisted patient, even from a real session');
  } finally { await stack.stop(); }
});

test('live reads off: a module session fails loudly with openemr_live_reads_disabled and never reads fixtures', async () => {
  const stack = await startStack(18973, 'off');
  const { base, rest } = stack;
  try {
    const read = moduleToken(LIVE_PATIENT);
    const write = moduleToken(LIVE_PATIENT, 'write-source-document');
    const page = await (await fetch(`${base}/?demo_token=${encodeURIComponent(read)}&write_token=${encodeURIComponent(write)}`)).text();
    assert.match(page, /Chart source: unavailable \(OpenEMR live reads are off\)/);

    const briefing = await (await post(base, '/v1/briefings', { patient_uuid: LIVE_PATIENT, clinician_uuid: clinician, demo_token: read })).json();
    assert.equal(briefing.disposition, 'blocked');
    assert.deepEqual(briefing.qualification.reasons, ['openemr_live_reads_disabled']);
    assert.deepEqual(briefing.claims, []);

    const { scan, scanned } = await uploadAndScan(base, write);
    assert.equal(scan.status, 403);
    assert.equal(scanned.error, 'openemr_live_reads_disabled');
    assert.equal(rest.requests.length, 0, 'nothing reads OpenEMR when live reads are off');
  } finally { await stack.stop(); }
});

test('live reads without external-provider approval: nothing leaves the process; the public demo and an approved live read do call out', async () => {
  const models = await startRecordingModelServer();
  const modelEnv = (approved, designated = [LIVE_PATIENT]) => ({
    AGENTFORGE_LIVE_PATIENT_UUIDS: designated.join(','),
    AGENTFORGE_PROVIDER_MODE: 'qwen', AGENTFORGE_MODEL_PROTOCOL: 'compatible', AGENTFORGE_MODEL_ENDPOINT: `${models.url}/qwen/chat/completions`, AGENTFORGE_MODEL_API_KEY: 'synthetic-key', AGENTFORGE_MODEL: 'synthetic-model',
    AGENTFORGE_CRITIC_MODEL: 'synthetic-critic', AGENTFORGE_OPENROUTER_ENDPOINT: `${models.url}/openrouter/chat/completions`, AGENTFORGE_OPENROUTER_API_KEY: 'synthetic-key',
    AGENTFORGE_RERANK_PROVIDER: 'qwen', AGENTFORGE_LIVE_EXTERNAL_PROVIDER_APPROVED: approved ? 'true' : 'false',
  });
  const unapproved = await startStack(18974, 'on', modelEnv(false));
  try {
    const write = moduleToken(LIVE_PATIENT, 'write-source-document');
    const { scan, scanned } = await uploadAndScan(unapproved.base, write);
    assert.equal(scan.status, 200);
    assert.equal(scanned.chart_source.chart_source, 'openemr_live');
    assert.equal(scanned.workflow.answer.critic_status, 'skipped_not_approved');
    assert.equal(models.requests.length, 0, `a live read without approval made ${models.requests.length} outbound model request(s)`);
    const briefing = await (await post(unapproved.base, '/v1/briefings', { patient_uuid: LIVE_PATIENT, clinician_uuid: clinician, demo_token: moduleToken(LIVE_PATIENT) })).json();
    assert.deepEqual(briefing.qualification.reasons, ['live_external_provider_not_approved']);
    const evidence = await (await post(unapproved.base, '/v1/follow-up-evidence', { patient_uuid: LIVE_PATIENT, clinician_uuid: clinician, demo_token: moduleToken(LIVE_PATIENT), message: 'blood pressure' })).json();
    assert.equal(evidence.retrieval.guideline_provider, 'bm25-sparse-only');
    assert.equal(models.requests.length, 0);
    // Sensitivity: the same server calls out for the public demo's fixture chart.
    const demo = await (await fetch(`${unapproved.base}/v1/source-document-context?patient_uuid=fixture-patient-001`)).json();
    const demoRead = await (await fetch(`${unapproved.base}/v1/demo-context?patient_uuid=fixture-patient-001`)).json();
    await post(unapproved.base, '/v1/briefings', { patient_uuid: 'fixture-patient-001', clinician_uuid: demoRead.clinician_uuid, demo_token: demoRead.demo_token });
    assert.ok(models.requests.length > 0, 'the fixture chart path does reach the model endpoint');
    assert.ok(demo.demo_token);
  } finally { await unapproved.stop(); }
  // Approval alone is not enough: the patient must be designated (AGENTFORGE_LIVE_PATIENT_UUIDS).
  const beforeUndesignated = models.requests.length;
  const undesignated = await startStack(18976, 'on', modelEnv(true, [OTHER_PATIENT]));
  try {
    const { scan, scanned } = await uploadAndScan(undesignated.base, moduleToken(LIVE_PATIENT, 'write-source-document'));
    assert.equal(scan.status, 200);
    assert.equal(scanned.workflow.answer.critic_status, 'skipped_not_approved');
    assert.equal(scanned.chart_source.designated_patient, false);
    assert.equal(models.requests.length, beforeUndesignated, 'an approved but undesignated live patient made outbound model requests');
  } finally { await undesignated.stop(); }
  const before = models.requests.length;
  const approved = await startStack(18975, 'on', modelEnv(true));
  try {
    const { scan, scanned } = await uploadAndScan(approved.base, moduleToken(LIVE_PATIENT, 'write-source-document'));
    assert.equal(scan.status, 200);
    assert.notEqual(scanned.workflow.answer.critic_status, 'skipped_not_approved');
    assert.ok(models.requests.length > before, 'with approval the live read reaches the model endpoint');
  } finally { await approved.stop(); await models.close(); }
});

test('live pages and responses: honest data labels, no-store and no-referrer, tokens stripped from the address bar', async () => {
  const stack = await startStack(18977, 'on', { AGENTFORGE_LIVE_PATIENT_UUIDS: LIVE_PATIENT });
  try {
    const { base } = stack;
    const read = moduleToken(LIVE_PATIENT);
    const pageResponse = await fetch(`${base}/?demo_token=${encodeURIComponent(read)}`);
    assert.equal(pageResponse.headers.get('cache-control'), 'no-store');
    assert.equal(pageResponse.headers.get('referrer-policy'), 'no-referrer');
    const page = await pageResponse.text();
    assert.match(page, /id="data-origin">Live OpenEMR chart \(synthetic patient\)</);
    assert.match(page, /history\.replaceState\(/);
    const demoPage = await (await fetch(`${base}/`)).text();
    assert.match(demoPage, /id="data-origin">Synthetic demonstration only</);
    const { scan, scanned } = await uploadAndScan(base, moduleToken(LIVE_PATIENT, 'write-source-document'));
    assert.equal(scan.headers.get('cache-control'), 'no-store');
    assert.equal(scan.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(scanned.synthetic_only, false, 'a live read is never labeled synthetic_only');
    assert.equal(scanned.chart_source.designated_patient, true);
    const evidence = await (await post(base, '/v1/follow-up-evidence', { patient_uuid: LIVE_PATIENT, clinician_uuid: clinician, demo_token: read, message: 'blood pressure' })).json();
    assert.equal(evidence.synthetic_only, false);
    const demo = await (await fetch(`${base}/v1/demo-context?patient_uuid=fixture-patient-001`)).json();
    const demoEvidence = await (await post(base, '/v1/follow-up-evidence', { patient_uuid: 'fixture-patient-001', clinician_uuid: demo.clinician_uuid, demo_token: demo.demo_token, message: 'blood pressure' })).json();
    assert.equal(demoEvidence.synthetic_only, true);
  } finally { await stack.stop(); }
});

test('live reads on without OpenEMR access settings: /ready is 503 and live requests are refused, loudly', async () => {
  const stack = await startStack(18978, 'on', { AGENTFORGE_OPENEMR_ACCESS_TOKEN: '' });
  try {
    const ready = await fetch(`${stack.base}/ready`);
    assert.equal(ready.status, 503);
    assert.equal((await ready.json()).dependencies.openemrLiveReadsConfiguration.status === 'ready', false);
    const briefing = await (await post(stack.base, '/v1/briefings', { patient_uuid: LIVE_PATIENT, clinician_uuid: clinician, demo_token: moduleToken(LIVE_PATIENT) })).json();
    assert.deepEqual(briefing.qualification.reasons, ['openemr_live_reads_not_configured']);
    assert.equal(stack.rest.requests.length, 0);
  } finally { await stack.stop(); }
});
