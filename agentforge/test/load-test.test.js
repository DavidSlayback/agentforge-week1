import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HARD_MAX_SCANS, buildPlan, expectedScanCost, latencySummary, percentile, plannedScanCount, summarize, summarizeDockerStats } from '../scripts/load-test.mjs';

const script = fileURLToPath(new URL('../scripts/load-test.mjs', import.meta.url));
const oneToHundred = Array.from({ length: 100 }, (_, index) => index + 1);

test('percentile uses the nearest-rank method', () => {
  assert.equal(percentile(oneToHundred, 50), 50);
  assert.equal(percentile(oneToHundred, 95), 95);
  assert.equal(percentile(oneToHundred, 99), 99);
  assert.equal(percentile(oneToHundred, 100), 100);
  assert.equal(percentile(oneToHundred, 0), 1);
  // Ten samples: p95 and p99 are both the largest, p50 the fifth.
  const ten = [10, 20, 30, 40, 50, 60, 70, 80, 90, 1000];
  assert.equal(percentile(ten, 50), 50);
  assert.equal(percentile(ten, 90), 90);
  assert.equal(percentile(ten, 95), 1000);
  assert.equal(percentile(ten, 99), 1000);
});

test('percentile sorts numerically, ignores non-numbers and handles edge sizes', () => {
  assert.equal(percentile([100, 9, 20, 3], 50), 9);
  assert.equal(percentile([5], 99), 5);
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([Number.NaN, 7, 3], 100), 7);
  assert.throws(() => percentile([1, 2], 101), RangeError);
  const input = [3, 1, 2];
  percentile(input, 50);
  assert.deepEqual(input, [3, 1, 2], 'input is not mutated');
});

test('latency summary and per-route breakdown count errors and throughput', () => {
  assert.deepEqual(latencySummary([1, 2, 3, 4]), { count: 4, min: 1, mean: 2.5, p50: 2, p95: 4, p99: 4, max: 4 });
  const results = [
    { route: 'health', status: 200, latency_ms: 5, ok: true, error: null },
    { route: 'health', status: 200, latency_ms: 7, ok: true, error: null },
    { route: 'briefing', status: 200, latency_ms: 100, ok: true, error: null },
    { route: 'briefing', status: 0, latency_ms: 60000, ok: false, error: 'client_timeout' },
  ];
  const summary = summarize(results, 2000);
  assert.equal(summary.requests, 4);
  assert.equal(summary.errors, 1);
  assert.equal(summary.error_rate, 0.25);
  assert.equal(summary.throughput_rps, 2);
  assert.equal(summary.latency_ms.p50, 7);
  assert.equal(summary.latency_ms.p99, 60000);
  assert.deepEqual(summary.per_route.briefing.statuses, { 0: 1, 200: 1 });
  assert.deepEqual(summary.per_route.briefing.error_codes, { client_timeout: 1 });
  assert.equal(summary.per_route.health.error_rate, 0);
});

test('the scan share is capped and cannot exceed the hard maximum', () => {
  assert.equal(plannedScanCount(200, 0.02, 4), 4);
  assert.equal(plannedScanCount(1000, 0.02, 4), 4);
  assert.equal(plannedScanCount(200, 0, 4), 0);
  assert.throws(() => plannedScanCount(200, 0.02, HARD_MAX_SCANS + 1), RangeError);
  assert.throws(() => plannedScanCount(200, 0.5, 4), RangeError);
  assert.deepEqual(expectedScanCost(4), { scans: 4, typical_usd: 0.00256, worst_case_usd: 0.00544, basis: expectedScanCost(4).basis });
});

test('a plan has exactly the requested size, the planned scans, and every route in the mix', () => {
  const plan = buildPlan({ requests: 200, scans: 4, seed: 11 });
  assert.equal(plan.length, 200);
  assert.equal(plan.filter((route) => route === 'scan-supervisor').length, 4);
  for (const route of ['health', 'ready', 'demo-context', 'briefing']) assert.ok(plan.includes(route), route);
  // Largest-remainder rounding: each route is within one request of its share.
  assert.ok(Math.abs(plan.filter((route) => route === 'briefing').length - 196 * 0.4) < 1);
  assert.deepEqual(buildPlan({ requests: 200, scans: 4, seed: 11 }), plan, 'same seed, same plan');
});

test('docker stats samples reduce to peak and mean CPU and memory per container', () => {
  const lines = [
    '2026-09-26T21:00:00Z {"Name":"agentforge-w2","CPUPerc":"10.00%","MemUsage":"50MiB / 3.818GiB"}',
    '2026-09-26T21:00:02Z {"Name":"agentforge-w2","CPUPerc":"30.00%","MemUsage":"70MiB / 3.818GiB"}',
    '2026-09-26T21:00:02Z {"Name":"openemr","CPUPerc":"5.5%","MemUsage":"1GiB / 3.818GiB"}',
    'not a sample',
  ].join('\n');
  const stats = summarizeDockerStats(lines);
  assert.equal(stats.unparsed_lines, 1);
  assert.equal(stats.first_sample_at, '2026-09-26T21:00:00Z');
  assert.equal(stats.last_sample_at, '2026-09-26T21:00:02Z');
  assert.deepEqual(stats.containers['agentforge-w2'], { samples: 2, cpu_percent: { max: 30, mean: 20 }, memory_mib: { max: 70, mean: 60 }, memory_limit_mib: 3909.63 });
  assert.equal(stats.containers.openemr.memory_mib.max, 1024);
});

test('the CLI refuses fewer than 200 requests and a remote target without --live', () => {
  const small = spawnSync(process.execPath, [script, '--base-url', 'http://127.0.0.1:1', '--requests', '100'], { encoding: 'utf8' });
  assert.equal(small.status, 2);
  assert.match(small.stderr, /at least 200/);
  const remote = spawnSync(process.execPath, [script, '--base-url', 'https://example.invalid/agentforge-w2'], { encoding: 'utf8' });
  assert.equal(remote.status, 2);
  assert.match(remote.stderr, /needs --live/);
  const tooManyScans = spawnSync(process.execPath, [script, '--dry-run', '--max-scans', String(HARD_MAX_SCANS + 1)], { encoding: 'utf8' });
  assert.equal(tooManyScans.status, 2);
});
