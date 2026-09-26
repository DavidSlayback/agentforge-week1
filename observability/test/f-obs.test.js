const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  AlertMonitor, FileTraceSink, InMemoryTraceSink, LangfuseOtelExporter, cachedCheck, createReadinessChecker, evaluateAlerts,
  positiveIntegerFromEnv, DEFAULT_TRACE_LIMIT,
} = require('../index');

// F-OBS: trace limit, trace store write probe, background alert evaluation,
// readiness that names the failing dependency, and the Langfuse probe.

test('the trace limit defaults to 500 and rejects anything but a positive integer', () => {
  assert.equal(DEFAULT_TRACE_LIMIT, 500);
  assert.equal(positiveIntegerFromEnv(undefined, DEFAULT_TRACE_LIMIT, 'AGENTFORGE_TRACE_LIMIT'), 500);
  assert.equal(positiveIntegerFromEnv('', DEFAULT_TRACE_LIMIT, 'AGENTFORGE_TRACE_LIMIT'), 500);
  assert.equal(positiveIntegerFromEnv('750', DEFAULT_TRACE_LIMIT, 'AGENTFORGE_TRACE_LIMIT'), 750);
  for (const bad of ['0', '-1', 'abc', '1.5', '10x']) {
    assert.throws(() => positiveIntegerFromEnv(bad, DEFAULT_TRACE_LIMIT, 'AGENTFORGE_TRACE_LIMIT'), /AGENTFORGE_TRACE_LIMIT must be a positive integer/);
  }
});

test('the file sink keeps up to its configured limit across a reload, and reports the limit', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-limit-'));
  try {
    const filePath = path.join(root, 'traces.json');
    const clock = () => new Date('2026-09-26T12:00:00.000Z').toISOString();
    const sink = new FileTraceSink({ filePath, maxTraces: 150, clock });
    for (let index = 0; index < 180; index += 1) sink.record({ status: 'success', correlationId: `corr-${index}` });
    await sink.flush();
    const reloaded = new FileTraceSink({ filePath, maxTraces: 150, clock });
    assert.equal(reloaded.list().length, 150);
    assert.equal(reloaded.list()[0].correlationId, 'corr-30');
    assert.equal(reloaded.snapshot().traceLimit, 150);
    assert.equal(new InMemoryTraceSink({ maxTraces: 7 }).snapshot().traceLimit, 7);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the trace store write probe writes a real file and fails when the directory is gone', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-probe-'));
  try {
    const dir = path.join(root, 'store');
    const sink = new FileTraceSink({ filePath: path.join(dir, 'traces.json') });
    assert.equal(await sink.probeWritable(), true);
    assert.deepEqual(fs.readdirSync(dir), [], 'the probe file is removed');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.writeFileSync(dir, 'not a directory');
    assert.equal(await sink.probeWritable(), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const firing = { latencyMs: { p95: 50000 }, errorRate: 0, toolFailureRate: 0, windowMs: 300000 };
const clear = { latencyMs: { p95: 100 }, errorRate: 0, toolFailureRate: 0, windowMs: 300000 };

test('the alert monitor logs each transition once, with codes only', () => {
  const logs = [];
  const snapshots = [clear, firing, firing, firing, clear, clear];
  const monitor = new AlertMonitor({ evaluate: () => evaluateAlerts(snapshots.shift(), { p95LatencyMs: 30000 }), intervalMs: 1000, log: (entry) => logs.push(entry) });
  for (let index = 0; index < 6; index += 1) monitor.evaluate();
  assert.deepEqual(logs, [
    { level: 'warn', event: 'agentforge_alert_transition', alert_id: 'p95_latency', state: 'firing', previous_state: 'ok', window_ms: 300000 },
    { level: 'info', event: 'agentforge_alert_transition', alert_id: 'p95_latency', state: 'ok', previous_state: 'firing', window_ms: 300000 },
  ]);
  const allowed = new Set(['level', 'event', 'alert_id', 'state', 'previous_state', 'window_ms']);
  for (const entry of logs) for (const key of Object.keys(entry)) assert.ok(allowed.has(key), `unexpected log key ${key}`);
  assert.equal(monitor.status().evaluations, 6);
});

test('the alert monitor evaluates on its own interval, without any request', async () => {
  const logs = [];
  let calls = 0;
  const monitor = new AlertMonitor({ evaluate: () => { calls += 1; return evaluateAlerts(firing, { p95LatencyMs: 30000 }); }, intervalMs: 10, log: (entry) => logs.push(entry) });
  monitor.start();
  try {
    await new Promise((resolve) => setTimeout(resolve, 120));
  } finally {
    monitor.stop();
  }
  assert.ok(calls >= 3, `expected background evaluations, got ${calls}`);
  assert.equal(logs.length, 1, 'a steady firing alert is logged once');
  const after = calls;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(calls, after, 'stop() ends the interval');
});

test('the alert monitor rejects a missing or invalid interval and logs a failed evaluation by code', () => {
  assert.throws(() => new AlertMonitor({ evaluate: () => ({}), intervalMs: 0 }), /ALERT_EVAL_INTERVAL_INVALID/);
  assert.throws(() => new AlertMonitor({ evaluate: () => ({}), intervalMs: Number.NaN }), /ALERT_EVAL_INTERVAL_INVALID/);
  const logs = [];
  const monitor = new AlertMonitor({ evaluate: () => { throw new Error('secret detail'); }, intervalMs: 1000, log: (entry) => logs.push(entry) });
  assert.equal(monitor.tick(), null);
  assert.deepEqual(logs, [{ level: 'error', event: 'agentforge_alert_evaluation_failed', error_code: 'ALERT_EVALUATION_FAILED' }]);
});

test('readiness names every failing dependency', async () => {
  const checker = createReadinessChecker({ trace: { checkReady: async () => true }, openemrModule: { checkReady: async () => false }, langfuse: { checkReady: async () => { throw new Error('boom'); } } });
  const result = await checker.ready();
  assert.equal(result.status, 'not_ready');
  assert.deepEqual(result.failing, ['openemrModule', 'langfuse']);
  assert.equal(result.dependencies.langfuse.errorCode, 'CHECK_FAILED');
  const ok = await createReadinessChecker({ trace: { checkReady: async () => true } }).ready();
  assert.deepEqual(ok.failing, []);
});

test('cachedCheck reuses a result inside its TTL and re-probes after it', async () => {
  let now = 0;
  let calls = 0;
  const check = cachedCheck(async () => { calls += 1; return calls === 1; }, { ttlMs: 1000, now: () => now });
  assert.equal(await check(), true);
  now = 500;
  assert.equal(await check(), true);
  assert.equal(calls, 1);
  now = 1500;
  assert.equal(await check(), false);
  assert.equal(calls, 2);
});

test('the Langfuse probe calls the public health route and fails closed', async () => {
  const requests = [];
  const exporter = (fetchImpl) => new LangfuseOtelExporter({ baseUrl: 'http://langfuse.test/', publicKey: 'pk', secretKey: 'sk', fetchImpl });
  assert.equal(await exporter(async (url, options) => { requests.push({ url, method: options.method }); return { ok: true, status: 200 }; }).checkReachable(), true);
  assert.deepEqual(requests, [{ url: 'http://langfuse.test/api/public/health', method: 'GET' }]);
  assert.equal(await exporter(async () => ({ ok: false, status: 503 })).checkReachable(), false);
  assert.equal(await exporter(async () => { throw new Error('ECONNREFUSED'); }).checkReachable(), false);
  assert.equal(await new LangfuseOtelExporter({ baseUrl: '', publicKey: '', secretKey: '' }).checkReachable(), false);
});
