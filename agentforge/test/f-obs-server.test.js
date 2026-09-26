import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFakeOpenEMRModule } from './fake-openemr-module.js';
import { startTestServer, waitForServer } from './helpers/testServer.js';
import { issueSignedContext } from '../src/accessContext.js';

// F-OBS over HTTP, against the deployed server.js: the trace limit, the
// background alert monitor, /ready naming its failing dependency, and the
// request correlation id. W2_ARCHITECTURE.md §4 debt #6, #9, #13, #18.

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const secret = 'synthetic-test-secret';
const moduleHmacSecret = 'synthetic-module-hmac-secret';
const LIVE_PATIENT = '7b3f0c52-1d4e-4c8a-9f21-5a6b7c8d9e01';
const clinician = '6f1e2d3c-4b5a-4968-8776-655443322110';

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-fobs-'));
const seedTraces = (filePath, count, { durationMs = 100 } = {}) => {
  const now = Date.now();
  const traces = Array.from({ length: count }, (_, index) => {
    const at = new Date(now - (count - index) * 10).toISOString();
    return { schemaVersion: 2, correlationId: `seed-${index}`, operation: 'w2-scan-supervisor', status: 'success', durationMs, completedAt: at, storedAt: at };
  });
  fs.writeFileSync(filePath, JSON.stringify(traces));
};
const stop = (child) => new Promise((resolve) => { if (!child || child.exitCode !== null) return resolve(); child.once('exit', resolve); child.kill(); });

/** Spawn server.js with stdout and stderr captured (the helper discards stderr). */
async function startCapturing(port, env) {
  const child = spawn(process.execPath, ['agentforge/src/server.js'], { cwd: repoRoot, env: { ...process.env, PORT: String(port), AGENTFORGE_DEMO_SECRET: secret, AGENTFORGE_SYNTHETIC_CONTEXT: 'true', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = { text: '' };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { output.text += chunk; });
  child.stdout.on('data', (chunk) => { output.text += chunk; });
  await waitForServer(child, { port, path: '/health' });
  return { child, output };
}

test('the trace cap is AGENTFORGE_TRACE_LIMIT: 500 by default, configurable, reported by /v1/metrics', async () => {
  const dir = tempDir();
  let child;
  try {
    const tracePath = path.join(dir, 'traces.json');
    seedTraces(tracePath, 150);
    child = await startTestServer(18981, { AGENTFORGE_TRACE_PATH: tracePath }, { path: '/health' });
    assert.equal((await (await fetch('http://127.0.0.1:18981/v1/traces')).json()).length, 150, 'no 100-trace cap');
    assert.equal((await (await fetch('http://127.0.0.1:18981/v1/metrics')).json()).traceLimit, 500);
    await stop(child);

    child = await startTestServer(18981, { AGENTFORGE_TRACE_PATH: tracePath, AGENTFORGE_TRACE_LIMIT: '3' }, { path: '/health' });
    const traces = await (await fetch('http://127.0.0.1:18981/v1/traces')).json();
    assert.deepEqual(traces.map((trace) => trace.correlationId), ['seed-147', 'seed-148', 'seed-149']);
    assert.equal((await (await fetch('http://127.0.0.1:18981/v1/metrics')).json()).traceLimit, 3);
  } finally {
    await stop(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an invalid AGENTFORGE_TRACE_LIMIT stops the process instead of falling back', async () => {
  const child = spawn(process.execPath, ['agentforge/src/server.js'], { cwd: repoRoot, env: { ...process.env, PORT: '18982', AGENTFORGE_DEMO_SECRET: secret, AGENTFORGE_TRACE_LIMIT: 'lots' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise((resolve) => child.once('exit', resolve));
  assert.notEqual(code, 0);
  assert.match(stderr, /AGENTFORGE_TRACE_LIMIT must be a positive integer/);
});

test('alerts are evaluated in the background and a transition is logged once, with codes only', async () => {
  const dir = tempDir();
  let server;
  try {
    const tracePath = path.join(dir, 'traces.json');
    seedTraces(tracePath, 5, { durationMs: 45000 });
    server = await startCapturing(18983, { AGENTFORGE_TRACE_PATH: tracePath, AGENTFORGE_ALERT_P95_MS: '30000', AGENTFORGE_ALERT_EVAL_INTERVAL_MS: '50' });
    // No request to /v1/alerts: only the background monitor can log this.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const transitions = server.output.text.split(/\r?\n/).filter((line) => line.includes('agentforge_alert_transition')).map((line) => JSON.parse(line));
    assert.deepEqual(transitions, [{ level: 'warn', event: 'agentforge_alert_transition', alert_id: 'p95_latency', state: 'firing', previous_state: 'ok', window_ms: 300000 }]);
    const alerts = await (await fetch('http://127.0.0.1:18983/v1/alerts')).json();
    assert.deepEqual(alerts.fired, ['p95_latency']);
    assert.equal(alerts.evaluation.intervalMs, 50);
    assert.ok(alerts.evaluation.evaluations >= 3, 'the monitor ran on its interval');
  } finally {
    await stop(server?.child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('/ready probes the OpenEMR module in openemr-module mode and names it when it fails', async () => {
  const dir = tempDir();
  const module = await startFakeOpenEMRModule({ hmacSecret: moduleHmacSecret, contextSecret: secret, allowlist: [LIVE_PATIENT] });
  const env = (url) => ({ AGENTFORGE_PROVIDER_MODE: 'qwen', AGENTFORGE_PERSISTENCE_MODE: 'openemr-module', AGENTFORGE_MODULE_HMAC_SECRET: moduleHmacSecret, AGENTFORGE_OPENEMR_MODULE_URL: url, AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS: LIVE_PATIENT, AGENTFORGE_OPENEMR_DEMO_PATIENT_MAP: '', AGENTFORGE_TRACE_PATH: path.join(dir, 'traces.json') });
  let child;
  try {
    child = await startTestServer(18984, env(module.url), { path: '/health' });
    const ready = await fetch('http://127.0.0.1:18984/ready');
    const body = await ready.json();
    assert.equal(ready.status, 200, JSON.stringify(body));
    assert.equal(body.dependencies.openemrModule.status, 'ready');
    const moduleRequests = (await (await fetch(`${new URL(module.url).origin}/__counts`)).json()).requests;
    assert.ok(moduleRequests >= 2, 'the module health route was called');
    await stop(child);

    // Nothing listens on this port: the module is unreachable.
    child = await startTestServer(18984, env('http://127.0.0.1:18989/api.php'), { path: '/health' });
    const down = await fetch('http://127.0.0.1:18984/ready');
    const downBody = await down.json();
    assert.equal(down.status, 503);
    assert.deepEqual(downBody.failing, ['openemrModule']);
  } finally {
    await stop(child);
    await module.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('/ready fails with the trace store named when the store cannot be written', async () => {
  const dir = tempDir();
  let child;
  try {
    const storeDir = path.join(dir, 'store');
    child = await startTestServer(18985, { AGENTFORGE_TRACE_PATH: path.join(storeDir, 'traces.json') }, { path: '/ready' });
    fs.rmSync(storeDir, { recursive: true, force: true });
    fs.writeFileSync(storeDir, 'not a directory');
    const ready = await fetch('http://127.0.0.1:18985/ready');
    assert.equal(ready.status, 503);
    assert.deepEqual((await ready.json()).failing, ['trace']);
  } finally {
    await stop(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('/ready probes Langfuse only when it is configured', async () => {
  const dir = tempDir();
  let healthy = true;
  const probes = [];
  const langfuse = http.createServer((req, res) => { probes.push(req.url); res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' }); res.end('{}'); });
  await new Promise((resolve) => langfuse.listen(0, '127.0.0.1', resolve));
  const env = { AGENTFORGE_TRACE_PATH: path.join(dir, 'traces.json'), LANGFUSE_BASE_URL: `http://127.0.0.1:${langfuse.address().port}`, LANGFUSE_PUBLIC_KEY: 'pk-synthetic', LANGFUSE_SECRET_KEY: 'sk-synthetic' };
  let child;
  try {
    child = await startTestServer(18986, env, { path: '/health' });
    const ready = await (await fetch('http://127.0.0.1:18986/ready')).json();
    assert.equal(ready.dependencies.langfuse.status, 'ready');
    assert.deepEqual(probes, ['/api/public/health']);
    await stop(child);

    healthy = false;
    child = await startTestServer(18986, env, { path: '/health' });
    const down = await fetch('http://127.0.0.1:18986/ready');
    assert.equal(down.status, 503);
    assert.deepEqual((await down.json()).failing, ['langfuse']);
    await stop(child);

    child = await startTestServer(18986, { AGENTFORGE_TRACE_PATH: path.join(dir, 'traces.json'), LANGFUSE_BASE_URL: '', LANGFUSE_PUBLIC_KEY: '', LANGFUSE_SECRET_KEY: '' }, { path: '/ready' });
    assert.equal('langfuse' in (await (await fetch('http://127.0.0.1:18986/ready')).json()).dependencies, false);
  } finally {
    await stop(child);
    await new Promise((resolve) => langfuse.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the request correlation id is echoed, and a scan trace is filed under it', async () => {
  const dir = tempDir();
  const module = await startFakeOpenEMRModule({ hmacSecret: moduleHmacSecret, contextSecret: secret, allowlist: [LIVE_PATIENT] });
  let child;
  try {
    child = await startTestServer(18987, { AGENTFORGE_PROVIDER_MODE: 'deterministic', AGENTFORGE_PERSISTENCE_MODE: 'openemr-module', AGENTFORGE_MODULE_HMAC_SECRET: moduleHmacSecret, AGENTFORGE_OPENEMR_MODULE_URL: module.url, AGENTFORGE_DEMO_WRITE_PATIENT_UUIDS: LIVE_PATIENT, AGENTFORGE_OPENEMR_DEMO_PATIENT_MAP: `fixture-patient-001=${LIVE_PATIENT}`, AGENTFORGE_TRACE_PATH: path.join(dir, 'traces.json') }, { path: '/health' });
    const base = 'http://127.0.0.1:18987';
    const echoed = await fetch(`${base}/health`, { headers: { 'x-correlation-id': 'corr-client-0001' } });
    assert.equal(echoed.headers.get('x-correlation-id'), 'corr-client-0001');
    const minted = await fetch(`${base}/health`, { headers: { 'x-correlation-id': 'bad id with spaces' } });
    assert.match(minted.headers.get('x-correlation-id'), /^af-[0-9a-f-]{36}$/);

    const write = issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', scope: 'write-source-document', acl: 'write', issuer: 'synthetic-demo', authn: 'synthetic', secret });
    const envelope = 'SYNTHETIC_SCAN_FORM|layout=pdf-ocr-lab_pdf|page_count=1\nFIELD|field_id=lab.a1c.test_name|label=A1C|value=A1C|unit=|quote=A1C|page=1|box=10,20,300,35|confidence=0.97\nFIELD|field_id=lab.a1c.value|label=A1C value|value=6.1|unit=%|quote=6.1|page=1|box=10,40,300,55|confidence=0.97';
    const post = (route, body, id) => fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-correlation-id': id }, body: JSON.stringify(body) });
    const upload = await post('/v1/source-documents', { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: write, document_type: 'lab_pdf', filename: 'lab.scan.txt', content_base64: Buffer.from(envelope).toString('base64') }, 'corr-upload-0001');
    assert.equal(upload.status, 200);
    const uploaded = await upload.json();
    const scan = await post('/v1/scan-supervisor', { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: write, source_document_id: uploaded.source_document.id, message: '' }, 'corr-scan-0001');
    assert.equal(scan.status, 200);
    assert.equal(scan.headers.get('x-correlation-id'), 'corr-scan-0001');
    const traces = await (await fetch(`${base}/v1/traces`)).json();
    const scanTrace = traces.find((trace) => trace.operation === 'w2-scan-supervisor');
    assert.equal(scanTrace.correlationId, 'corr-scan-0001');
  } finally {
    await stop(child);
    await module.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
