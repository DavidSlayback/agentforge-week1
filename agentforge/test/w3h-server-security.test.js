import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTestServer, DEMO_KEY_REQUEST } from './helpers/testServer.js';

// W3 hardening lane H2 (service security), checks on the real HTTP server.
// Service-level checks for the same lane live in w3h-service-security.test.js.

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-w3h-'));
const stop = (child) => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill(); });
const post = (base, route, body, headers = {}) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const mint = async (base, route = '/v1/demo-context', patient = 'fixture-patient-001') => (await fetch(`${base}${route}?patient_uuid=${patient}`, DEMO_KEY_REQUEST)).json();
const PATH_SEGMENT = 'Jane-Doe-1980-04-12';

test('item 2: a refused follow-up records no trace, never stores its path segment, and is counted as a refusal', async () => {
  const dir = tempDir();
  const port = 18991;
  const base = `http://127.0.0.1:${port}`;
  let child;
  try {
    child = await startTestServer(port, { AGENTFORGE_TRACE_PATH: path.join(dir, 'traces.json') });
    const before = await (await fetch(`${base}/v1/metrics`)).json();
    // No context token at all.
    const anonymous = await (await post(base, `/v1/conversations/${PATH_SEGMENT}/messages`, { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', message: 'What changed?' })).json();
    assert.equal(anonymous.disposition, 'blocked');
    // A valid token, but a conversation id that names no cached conversation.
    const context = await mint(base);
    const unknown = await (await post(base, `/v1/conversations/${PATH_SEGMENT}-2/messages`, { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', message: 'What changed?', demo_token: context.demo_token })).json();
    assert.equal(unknown.disposition, 'blocked');
    assert.deepEqual(unknown.qualification.reasons, ['conversation_scope_invalid']);
    const traces = await (await fetch(`${base}/v1/traces`)).json();
    assert.ok(!JSON.stringify(traces).includes('Jane-Doe'), 'the path segment never reaches the trace store');
    assert.equal(traces.length, 0, 'a refused follow-up records no trace');
    const after = await (await fetch(`${base}/v1/metrics`)).json();
    assert.equal(after.requests, before.requests, 'refusals do not count as traced requests (no dilution of error rate or p95)');
    assert.equal(after.refusals.total - before.refusals.total, 2);
    assert.equal(after.refusals.byReason.conversation_scope_invalid, 2);
    // An HTTP refusal (403) is counted by its code too.
    assert.equal((await post(base, '/v1/follow-up-evidence', { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', message: 'What changed?', demo_token: 'forged' })).status, 403);
    assert.equal((await (await fetch(`${base}/v1/metrics`)).json()).refusals.byReason.invalid_demo_context, 1);
  } finally {
    await stop(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('item 2: briefing and follow-up traces are filed under the request correlation id', async () => {
  const dir = tempDir();
  const port = 18992;
  const base = `http://127.0.0.1:${port}`;
  let child;
  try {
    child = await startTestServer(port, { AGENTFORGE_TRACE_PATH: path.join(dir, 'traces.json') });
    const context = await mint(base);
    const briefingId = randomUUID();
    const briefing = await (await post(base, '/v1/briefings', { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: context.demo_token }, { 'x-correlation-id': briefingId })).json();
    assert.equal(briefing.disposition, 'complete');
    const followUpId = randomUUID();
    const followUp = await post(base, `/v1/conversations/${encodeURIComponent(briefing.correlation_id)}/messages`, { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', message: 'What changed since the last visit?', demo_token: context.demo_token }, { 'x-correlation-id': followUpId });
    assert.equal(followUp.headers.get('x-correlation-id'), followUpId);
    assert.equal((await followUp.json()).correlation_id, briefing.correlation_id, 'the conversation id is unchanged');
    const traces = await (await fetch(`${base}/v1/traces`)).json();
    assert.deepEqual(traces.filter((trace) => trace.operation === 'visit_briefing').map((trace) => trace.correlationId), [briefingId]);
    assert.deepEqual(traces.filter((trace) => trace.operation === 'conversation_followup').map((trace) => trace.correlationId), [followUpId]);
  } finally {
    await stop(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('item 3: /ready is 503 model not_configured when a real provider mode has no endpoint or key; explicit deterministic mode is ready and labeled', async () => {
  const dir = tempDir();
  const port = 18993;
  const base = `http://127.0.0.1:${port}`;
  let child;
  try {
    child = await startTestServer(port, { AGENTFORGE_TRACE_PATH: path.join(dir, 'traces.json'), AGENTFORGE_PROVIDER_MODE: 'qwen', AGENTFORGE_MODEL_ENDPOINT: '', AGENTFORGE_MODEL_API_KEY: '' }, { path: '/health' });
    const ready = await fetch(`${base}/ready`);
    const body = await ready.json();
    assert.equal(ready.status, 503);
    assert.deepEqual(body.failing, ['model']);
    assert.deepEqual(body.dependencies.model, { status: 'not_ready', reason: 'not_configured' });
    await stop(child);

    child = await startTestServer(port, { AGENTFORGE_TRACE_PATH: path.join(dir, 'traces.json'), AGENTFORGE_PROVIDER_MODE: 'openrouter', AGENTFORGE_OPENROUTER_API_KEY: '' }, { path: '/health' });
    assert.equal((await (await fetch(`${base}/ready`)).json()).dependencies.model.status, 'not_ready');
    await stop(child);

    child = await startTestServer(port, { AGENTFORGE_TRACE_PATH: path.join(dir, 'traces.json'), AGENTFORGE_PROVIDER_MODE: 'deterministic' });
    const deterministic = await (await fetch(`${base}/ready`)).json();
    assert.equal(deterministic.status, 'ready');
    assert.deepEqual(deterministic.dependencies.model, { status: 'ready', mode: 'deterministic' });
  } finally {
    await stop(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('item 3: concurrent /ready calls share one in-flight model probe', async () => {
  const dir = tempDir();
  const port = 18994;
  const base = `http://127.0.0.1:${port}`;
  let probes = 0;
  const model = http.createServer((req, res) => { probes += 1; req.resume(); setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"choices":[{"message":{"content":"OK"}}]}'); }, 200); });
  await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve));
  let child;
  try {
    child = await startTestServer(port, { AGENTFORGE_TRACE_PATH: path.join(dir, 'traces.json'), AGENTFORGE_PROVIDER_MODE: 'qwen', AGENTFORGE_MODEL_PROTOCOL: 'compatible', AGENTFORGE_MODEL_ENDPOINT: `http://127.0.0.1:${model.address().port}/v1/chat/completions`, AGENTFORGE_MODEL_API_KEY: 'synthetic-key', AGENTFORGE_MODEL: 'synthetic-model' }, { path: '/health' });
    const responses = await Promise.all(Array.from({ length: 20 }, () => fetch(`${base}/ready`)));
    const bodies = await Promise.all(responses.map((response) => response.json()));
    assert.ok(bodies.every((body) => body.dependencies.model.status === 'ready'), JSON.stringify(bodies[0]));
    assert.equal(probes, 1, 'twenty concurrent /ready calls cost one model call');
  } finally {
    await stop(child);
    await new Promise((resolve) => model.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('item 4 and 5: malformed ids and scope mismatches are 4xx with a code, and over-long questions are 400', async () => {
  const dir = tempDir();
  const port = 18995;
  const base = `http://127.0.0.1:${port}`;
  let child;
  try {
    child = await startTestServer(port, { AGENTFORGE_TRACE_PATH: path.join(dir, 'traces.json') });
    const write = await mint(base, '/v1/source-document-context');
    const upload = await (await post(base, '/v1/source-documents', { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: write.demo_token, document_type: 'lab_pdf', filename: 'lab.scan.txt', content_base64: fs.readFileSync(new URL('../../docs/agentforge/fixtures/scan-forms/lab-layout-a-complete.scan.txt', import.meta.url)).toString('base64') })).json();
    const other = await mint(base, '/v1/demo-context', 'fixture-patient-002');
    const malformed = '%E0%A4%A';
    for (const route of [`/v1/source-documents/${malformed}/scan-form-evidence`, `/v1/source-documents/${malformed}/source-preview`, `/v1/source-documents/${malformed}`, `/v1/source-documents/${malformed}/openemr-observations`]) {
      const response = await fetch(`${base}${route}?patient_uuid=fixture-patient-001&demo_token=${encodeURIComponent(write.demo_token)}`);
      const text = await response.text();
      assert.ok(response.status === 400 || response.status === 403, `${route}: ${response.status}`);
      assert.doesNotMatch(text, /URI malformed/i, route);
    }
    // Another patient's document through the source preview: 403, not 500.
    const crossPatient = await fetch(`${base}/v1/source-documents/${upload.source_document.id}/source-preview?patient_uuid=fixture-patient-002&demo_token=${encodeURIComponent(other.demo_token)}`);
    assert.equal(crossPatient.status, 403);
    assert.deepEqual(await crossPatient.json(), { error: 'invalid_demo_context' });

    const longQuestion = 'x'.repeat(2001);
    const read = await mint(base);
    const evidence = await post(base, '/v1/follow-up-evidence', { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', message: longQuestion, demo_token: read.demo_token });
    assert.equal(evidence.status, 400);
    assert.ok((await evidence.json()).issues.includes('message_too_long'));
    const followUp = await post(base, '/v1/conversations/af-0000000000000-0000000000000000/messages', { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', message: longQuestion, demo_token: read.demo_token });
    assert.equal(followUp.status, 400);
    const scan = await post(base, '/v1/scan-supervisor', { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', source_document_id: upload.source_document.id, message: longQuestion, demo_token: write.demo_token });
    assert.equal(scan.status, 400);
    assert.ok((await scan.json()).issues.includes('message_too_long'));
    // 2000 characters is still accepted.
    assert.equal((await post(base, '/v1/follow-up-evidence', { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', message: 'y'.repeat(2000), demo_token: read.demo_token })).status, 200);
  } finally {
    await stop(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('item 4: an uncoded error reaches the client as internal_error, never as its message', async () => {
  const dir = tempDir();
  const port = 18996;
  const base = `http://127.0.0.1:${port}`;
  let child;
  try {
    child = await startTestServer(port, { AGENTFORGE_TRACE_PATH: path.join(dir, 'traces.json'), AGENTFORGE_TEST_SOURCE_DOCUMENT_FAILURE: 'uncoded' });
    const write = await mint(base, '/v1/source-document-context');
    const response = await post(base, '/v1/source-documents', { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: write.demo_token, document_type: 'lab_pdf', filename: 'lab.scan.txt', content_base64: Buffer.from('SYNTHETIC_SCAN_FORM|layout=lab-a|page_count=1').toString('base64') });
    const text = await response.text();
    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(text), { error: 'internal_error' });
    assert.doesNotMatch(text, /Test Patient|var\/lib|upstream/);
  } finally {
    await stop(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
