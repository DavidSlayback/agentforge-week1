import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import observability from '../../observability/index.js';
import { computeDashboardMetrics, renderObservabilityPage } from '../src/observabilityPage.js';
import { startTestServer } from './helpers/testServer.js';

const { InMemoryTraceSink, evaluateAlerts } = observability;
const fixturePath = fileURLToPath(new URL('./fixtures/observability/fake-traces.json', import.meta.url));
const traces = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
test('fake traces render preview KPIs, alert states, optional fields, and no PHI sentinels', () => {
  assert.ok(traces.length >= 15 && traces.length <= 25);
  const sink = new InMemoryTraceSink({ maxTraces: traces.length });
  for (const trace of traces) sink.record(trace);
  const snapshot = sink.snapshot();
  const alerts = evaluateAlerts(snapshot);
  const metrics = computeDashboardMetrics(traces);
  const preview = renderObservabilityPage({ previewData: { traces, metrics: snapshot, alerts } });

  assert.equal(metrics.requests, traces.length);
  assert.equal(metrics.errorRate, traces.filter((trace) => ['failure', 'deadline-exceeded'].includes(trace.status)).length / traces.length);
  assert.equal(metrics.p95, snapshot.latencyMs.p95);
  assert.notEqual(metrics.p95, metrics.p50, 'slow outlier makes p95 distinct from median');
  assert.equal(metrics.totalTokens, snapshot.tokens.total);
  assert.equal(metrics.totalCost, snapshot.estimatedCostUsd);
  assert.match(preview, /FAKE DATA — preview only/);
  assert.match(preview, /Total requests/);
  assert.match(preview, /p95 latency/);
  assert.match(preview, /const n=\(v,s=''.*:'—'/);
  assert.match(preview, /prefers-color-scheme:dark/);
  assert.doesNotMatch(preview, /<script\s+src=/i);
  assert.match(preview, /alerts=|"rules"/);
  for (const rule of alerts.rules) {
    assert.match(preview, new RegExp(`\\"id\\":\\"${rule.id}\\"`));
    assert.match(preview, new RegExp(`\\"triggered\\":${rule.triggered}`));
  }
  for (const sentinel of ['Test Patient One', '1980-04-12', '555-0100', 'Metformin', 'Penicillin', '13.2']) assert.ok(!preview.includes(sentinel), `preview contains PHI sentinel ${sentinel}`);

  const oldTrace = traces.find((trace) => !trace.extraction?.confidence);
  const oldRowData = JSON.stringify(oldTrace);
  assert.ok(oldTrace);
  assert.doesNotMatch(oldRowData, /"decisions"|"confidence"/);
  assert.match(renderObservabilityPage({ previewData: { traces: [oldTrace], metrics: {}, alerts: {} } }), /fake-s9-020/);
});

test('production dashboard route has no fake banner or fixture import', async (t) => {
  const source = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /fake-traces\.json/);
  assert.doesNotMatch(source, /fixtures\/observability/);
  const child = await startTestServer(18796, { AGENTFORGE_OPENEMR_MODE: 'synthetic' });
  t.after(() => child.kill());
  const page = await fetch('http://127.0.0.1:18796/observability').then((response) => response.text());
  assert.doesNotMatch(page, /FAKE DATA/);
  assert.match(page, /all-time retained trace set/);
  assert.doesNotMatch(page, /minute window/);
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new Function(scripts[0][1]));
});
