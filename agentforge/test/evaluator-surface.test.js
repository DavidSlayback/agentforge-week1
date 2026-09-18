import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const port = 18795;
const agentforgeRoot = fileURLToPath(new URL('..', import.meta.url));
let child;

async function startServer() {
  child = spawn(process.execPath, ['src/server.js'], { cwd: agentforgeRoot, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  for (const href of ['/health', '/ready', '/v1/metrics', '/v1/traces', '/v1/alerts', '/observability', '/evals/deployed-service-results.json', '/evals/error-analysis.json']) assert.match(page, new RegExp(`href="${href.replaceAll('/', '\\/')}"`));
  assert.match(page, /Golden evidence/);
  assert.match(page, /Mutation\/error analysis/);
  assert.match(page, /synthetic fixture and harness results/i);

  const golden = await fetch(`http://127.0.0.1:${port}/evals/deployed-service-results.json`).then((response) => response.json());
  const errorAnalysis = await fetch(`http://127.0.0.1:${port}/evals/error-analysis.json`).then((response) => response.json());
  assert.equal(golden.gate_passed, true);
  assert.equal(errorAnalysis.gate_passed, true);
  assert.equal(golden.total_cases, 7);
  assert.equal(errorAnalysis.total_mutations, 6);
});
