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

// Review fixes (F-OBS round 2).

for (const [label, content] of [['truncated', '[{"correlationId":"a","status":"succ'], ['empty', '']]) {
  test(`a ${label} trace file is moved aside and the store starts empty and not ready until a write succeeds`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-corrupt-'));
    try {
      const filePath = path.join(root, 'w2-traces.json');
      fs.writeFileSync(filePath, content);
      const logs = [];
      const sink = new FileTraceSink({ filePath, clock: () => '2026-09-26T20:00:00.000Z', log: (entry) => logs.push(entry) });
      assert.deepEqual(sink.list(), []);
      const aside = fs.readdirSync(root).filter((name) => /^w2-traces\.corrupt-\d+\.json$/.test(name));
      assert.equal(aside.length, 1, 'the corrupt file is kept for inspection');
      assert.equal(fs.readFileSync(path.join(root, aside[0]), 'utf8'), content);
      assert.equal(fs.existsSync(filePath), false);
      assert.deepEqual(logs, [{ level: 'error', event: 'agentforge_trace_store_recovered', error_code: 'TRACE_STORE_CORRUPT' }]);
      assert.deepEqual([sink.health().status, sink.health().errorCode], ['not_ready', 'TRACE_STORE_CORRUPT']);
      sink.record({ status: 'success', correlationId: 'after-recovery' });
      await sink.flush();
      assert.deepEqual([sink.health().status, sink.health().errorCode], ['ok', null]);
      assert.equal(JSON.parse(fs.readFileSync(filePath, 'utf8')).length, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test('an explicit restore of a corrupt backup still fails loudly', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-restore-'));
  try {
    const sink = new FileTraceSink({ filePath: path.join(root, 'traces.json') });
    fs.writeFileSync(path.join(root, 'backup.json'), '[{');
    await assert.rejects(sink.restore(path.join(root, 'backup.json')), SyntaxError);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cachedCheck coalesces concurrent calls into one probe per window', async () => {
  let now = 0;
  let calls = 0;
  let release;
  const check = cachedCheck(() => { calls += 1; return new Promise((resolve) => { release = resolve; }); }, { ttlMs: 1000, now: () => now });
  const pending = Array.from({ length: 20 }, () => check());
  release({ ready: true });
  const results = await Promise.all(pending);
  assert.equal(calls, 1, 'twenty concurrent calls, one probe');
  assert.ok(results.every((value) => value.ready === true));
  now = 500;
  await check();
  assert.equal(calls, 1);
  now = 2000;
  const next = check();
  release(false);
  assert.equal(await next, false);
  assert.equal(calls, 2);
});

test('a failing probe is not cached as a success and the next call re-probes', async () => {
  let calls = 0;
  const check = cachedCheck(async () => { calls += 1; throw new Error('boom'); }, { ttlMs: 1000, now: () => 0 });
  await assert.rejects(Promise.all([check(), check()]));
  assert.equal(calls, 1);
  await assert.rejects(check());
  assert.equal(calls, 2);
});

test('readiness carries a dependency reason code', async () => {
  const result = await createReadinessChecker({ traceStore: { checkReady: async () => ({ ready: false, reason: 'TRACE_STORE_CORRUPT' }) }, model: { checkReady: async () => ({ ready: true }) } }).ready();
  assert.deepEqual(result.failing, ['traceStore']);
  assert.deepEqual(result.dependencies.traceStore, { status: 'not_ready', reason: 'TRACE_STORE_CORRUPT' });
  assert.deepEqual(result.dependencies.model, { status: 'ready' });
});
