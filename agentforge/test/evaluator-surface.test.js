import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { renderEvaluatorPage } from '../src/ui.js';
import { W2_GATE_CASE_COUNT } from '../src/w2RegressionGate.js';
import { startTestServer } from './helpers/testServer.js';

const port = 18795;
const agentforgeRoot = fileURLToPath(new URL('..', import.meta.url));
let child;

async function startServer() {
  child = await startTestServer(port, { AGENTFORGE_OPENEMR_MODE: 'synthetic' });
}

test.before(async () => startServer());
test.after(() => child?.kill());

test('evaluator panel exposes operational routes and saved evidence', async () => {
  const page = await fetch(`http://127.0.0.1:${port}/evals`).then((response) => response.text());
  for (const href of ['/health', '/ready', '/v1/metrics', '/v1/traces', '/v1/alerts', '/observability', '/evals/deployed-service-results.json', '/evals/error-analysis.json', '/evals/w2-baseline.json']) assert.match(page, new RegExp(`href="${href.replaceAll('/', '\\/')}"`));
  assert.match(page, /Week 1 baseline evidence/);
  assert.match(page, /Mutation\/error analysis/);
  assert.match(page, /W2 regression gate/);
  assert.match(page, new RegExp(String(W2_GATE_CASE_COUNT)));
  assert.match(page, /synthetic fixture and harness results/i);

  const dashboard = await fetch(`http://127.0.0.1:${port}/observability`).then((response) => response.text());
  for (const id of ['kpis', 'alerts', 'summary', 'traces', 'updated', 'pause']) assert.match(dashboard, new RegExp(`id="${id}"`));
  assert.match(dashboard, /Recent encounters/);
  assert.match(dashboard, /all-time retained trace set/i);
  assert.match(dashboard, /10000/);
  assert.doesNotMatch(dashboard, /minute window/);
  assert.doesNotMatch(dashboard, /FAKE DATA/);
  assert.doesNotMatch(dashboard, /live provider/);
  assert.doesNotMatch(dashboard, /<pre id="alerts"/);

  const golden = await fetch(`http://127.0.0.1:${port}/evals/deployed-service-results.json`).then((response) => response.json());
  const errorAnalysis = await fetch(`http://127.0.0.1:${port}/evals/error-analysis.json`).then((response) => response.json());
  const w2Baseline = await fetch(`http://127.0.0.1:${port}/evals/w2-baseline.json`).then((response) => response.json());
  assert.equal(golden.gate_passed, true);
  assert.equal(errorAnalysis.gate_passed, true);
  assert.equal(golden.total_cases, 7);
  assert.equal(errorAnalysis.total_mutations, 6);
  assert.equal(w2Baseline.total_cases, W2_GATE_CASE_COUNT);
  assert.equal(w2Baseline.passed, true);

  const prefixed = renderEvaluatorPage({ golden: {}, errorAnalysis: {}, basePath: '/agentforge' });
  for (const href of ['/health', '/ready', '/v1/metrics', '/v1/traces', '/v1/alerts', '/observability', '/evals/deployed-service-results.json', '/evals/error-analysis.json', '/evals/w2-baseline.json']) assert.match(prefixed, new RegExp(`href="/agentforge${href.replaceAll('/', '\\/')}"`));
});
