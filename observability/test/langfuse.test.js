const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { LangfuseOtelExporter, LangfuseTraceSink } = require('../index');

test('Langfuse exporter sends OTLP v4 metadata without sensitive values', async () => {
  let request;
  const exporter = new LangfuseOtelExporter({
    baseUrl: 'http://langfuse.test/',
    publicKey: 'pk-test',
    secretKey: 'sk-test',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 207 };
    },
    idFactory: (bytes) => 'a'.repeat(bytes * 2),
    now: () => Date.parse('2026-09-19T00:00:00.000Z'),
  });
  const result = await exporter.export({
    correlationId: 'corr-synthetic',
    operation: 'briefing',
    status: 'success',
    startedAt: '2026-09-19T00:00:00.000Z',
    completedAt: '2026-09-19T00:00:00.100Z',
    patientId: 'patient-secret',
    chartExcerpt: 'synthetic chart secret',
  });

  assert.deepEqual(result, { status: 'exported' });
  assert.equal(request.url, 'http://langfuse.test/api/public/otel/v1/traces');
  assert.equal(request.options.headers['x-langfuse-ingestion-version'], '4');
  assert.match(request.options.headers.authorization, /^Basic /);
  const body = JSON.parse(request.options.body);
  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, /patient-secret|synthetic chart secret|sk-test/);
  assert.doesNotMatch(serialized, /patientId|chartExcerpt/);
  assert.match(serialized, /corr-synthetic/);
  assert.equal(body.resourceSpans[0].scopeSpans[0].spans[0].startTimeUnixNano, '1789776000000000000');
  assert.equal(body.resourceSpans[0].scopeSpans[0].spans[0].endTimeUnixNano, '1789776000100000000');
  assert.equal(body.resourceSpans[0].scopeSpans[0].spans[0].traceId.length, 32);
});

test('Langfuse outage does not prevent local redacted persistence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-langfuse-'));
  const errors = [];
  const exporter = { isConfigured: () => true, status: () => ({ configured: true }), export: async () => ({ status: 'failed', errorCode: 'TIMEOUT' }) };
  const sink = new LangfuseTraceSink({ filePath: path.join(root, 'traces.json'), exporter, onExportError: (error) => errors.push(error) });
  sink.record({ correlationId: 'corr-outage', status: 'failure', patientId: 'patient-secret' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(sink.list().length, 1);
  assert.equal(sink.list()[0].patientId, '[REDACTED]');
  assert.deepEqual(errors, [{ correlationId: 'corr-outage', errorCode: 'TIMEOUT' }]);
  fs.rmSync(root, { recursive: true, force: true });
});

test('Langfuse export pressure is bounded without affecting local persistence', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-langfuse-queue-'));
  let calls = 0;
  let release;
  const errors = [];
  const exporter = { isConfigured: () => true, status: () => ({ configured: true }), export: async () => { calls += 1; await new Promise((resolve) => { release = resolve; }); return { status: 'exported' }; } };
  const sink = new LangfuseTraceSink({ filePath: path.join(root, 'traces.json'), exporter, maxPendingExports: 1, onExportError: (error) => errors.push(error) });
  sink.record({ correlationId: 'corr-first', status: 'success' });
  sink.record({ correlationId: 'corr-second', status: 'success' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls, 1);
  assert.equal(sink.list().length, 2);
  assert.equal(sink.snapshot().queueDepth, 1);
  assert.equal(sink.snapshot().telemetry.pendingExports, 1);
  assert.equal(sink.health().status, 'ok');
  assert.equal(sink.health().langfuse.droppedExports, 1);
  assert.deepEqual(errors, [{ correlationId: 'corr-second', errorCode: 'EXPORT_QUEUE_FULL' }]);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sink.snapshot().queueDepth, 0);
  assert.equal(sink.snapshot().telemetry.droppedExports, 1);
  fs.rmSync(root, { recursive: true, force: true });
});
