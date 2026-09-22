import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { renderEvaluatorPage } from '../src/ui.js';

const port = 18795;
const agentforgeRoot = fileURLToPath(new URL('..', import.meta.url));
let child;

async function startServer() {
  child = spawn(process.execPath, ['src/server.js'], { cwd: agentforgeRoot, env: { ...process.env, PORT: String(port), AGENTFORGE_OPENEMR_MODE: 'synthetic', AGENTFORGE_SYNTHETIC_CONTEXT: 'true', AGENTFORGE_DEMO_SECRET: 'synthetic-test-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/ready`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('AgentForge test server did not become ready');
}

test.before(async () => startServer());
test.after(() => child?.kill());

test('evaluator panel exposes operational routes and saved evidence', async () => {
  const page = await fetch(`http://127.0.0.1:${port}/evals`).then((response) => response.text());
  for (const href of ['/health', '/ready', '/v1/metrics', '/v1/traces', '/v1/alerts', '/observability', '/evals/deployed-service-results.json', '/evals/error-analysis.json', '/evals/w2-baseline.json']) assert.match(page, new RegExp(`href="${href.replaceAll('/', '\\/')}"`));
  assert.match(page, /Golden evidence/);
  assert.match(page, /Mutation\/error analysis/);
  assert.match(page, /W2 regression gate/);
  assert.match(page, /50/);
  assert.match(page, /synthetic fixture and harness results/i);

  const dashboard = await fetch(`http://127.0.0.1:${port}/observability`).then((response) => response.text());
  for (const id of ['metric-cards', 'latency-bars', 'verification-bars', 'alerts', 'traces']) assert.match(dashboard, new RegExp(`id="${id}"`));
  assert.match(dashboard, /Runtime dashboard/);
  assert.match(dashboard, /synthetic data only/i);
  assert.doesNotMatch(dashboard, /<pre id="alerts"/);

  const golden = await fetch(`http://127.0.0.1:${port}/evals/deployed-service-results.json`).then((response) => response.json());
  const errorAnalysis = await fetch(`http://127.0.0.1:${port}/evals/error-analysis.json`).then((response) => response.json());
  const w2Baseline = await fetch(`http://127.0.0.1:${port}/evals/w2-baseline.json`).then((response) => response.json());
  assert.equal(golden.gate_passed, true);
  assert.equal(errorAnalysis.gate_passed, true);
  assert.equal(golden.total_cases, 7);
  assert.equal(errorAnalysis.total_mutations, 6);
  assert.equal(w2Baseline.total_cases, 50);
  assert.equal(w2Baseline.passed, true);

  const prefixed = renderEvaluatorPage({ golden: {}, errorAnalysis: {}, basePath: '/agentforge' });
  for (const href of ['/health', '/ready', '/v1/metrics', '/v1/traces', '/v1/alerts', '/observability', '/evals/deployed-service-results.json', '/evals/error-analysis.json', '/evals/w2-baseline.json']) assert.match(prefixed, new RegExp(`href="/agentforge${href.replaceAll('/', '\\/')}"`));
});
