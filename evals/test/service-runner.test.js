const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
// Shared startup helper (ESM, loaded through require(esm) on Node 24).
const { startTestServer, TEST_DEMO_ACCESS_KEY } = require('../../agentforge/test/helpers/testServer.js');

const base = path.resolve(__dirname, '../..');

test('golden suite can evaluate the running AgentForge service', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-evals-'));
  const tracePath = path.join(root, 'traces.json');
  const child = await startTestServer(18788, { AGENTFORGE_TRACE_PATH: tracePath });
  try {
    const result = await new Promise((resolve, reject) => {
      // The spawned service signs with startTestServer's test secret; the
      // expired-token adversarial case needs it to mint an expired token.
      const runner = spawn(process.execPath, ['evals/lib/runner.js', '--service', 'http://127.0.0.1:18788'], { cwd: base, env: { ...process.env, AGENTFORGE_EVAL_DEMO_SECRET: 'synthetic-test-secret', AGENTFORGE_DEMO_ACCESS_KEY: TEST_DEMO_ACCESS_KEY } });
      let output = '';
      runner.stdout.on('data', (data) => { output += data; });
      runner.on('error', reject);
      runner.on('close', (code) => code ? reject(new Error(output)) : resolve(JSON.parse(output)));
    });
    assert.equal(result.total_cases, 9);
    assert.equal(result.passed_cases, 9);
    assert.equal(result.critical_failures, 0);
    assert.equal(result.golden_gate_passed, true);
    assert.equal(result.adversarial.gate_passed, true, JSON.stringify(result.adversarial.cases.filter((item) => !item.passed)));
    assert.deepEqual(result.adversarial.unauthorized, { total: 6, passed: 6 });
    assert.deepEqual(result.adversarial.ambiguous, { total: 3, passed: 3 });
    assert.equal(result.gate_passed, true);
    const metrics = await (await fetch('http://127.0.0.1:18788/v1/metrics')).json();
    // 9 golden briefings + 8 traced adversarial calls. Refused requests (the
    // 403s at the HTTP boundary, and briefings or follow-ups that fail
    // authorization or conversation scope) record no trace since the W3
    // hardening (H2); they are counted in `refusals` instead.
    assert.equal(metrics.requests, 17);
    assert.deepEqual(metrics.refusals, { total: 6, byReason: { invalid_demo_context: 4, conversation_scope_invalid: 1, server_context_missing_or_invalid: 1 } });
    assert.ok(metrics.retrievalAttempts >= 9);
    const dashboard = await (await fetch('http://127.0.0.1:18788/observability')).text();
    assert.ok(dashboard.includes('Observability'));
    for (const route of ['/v1/metrics', '/v1/alerts', '/v1/traces']) assert.ok(dashboard.includes(route));
  } finally {
    // Wait for the child to actually exit (and release port 18788) before
    // this test returns, so a back-to-back run of this suite — or the
    // regression matrix running it many times in one process — can never
    // race a still-live server on the same fixed port.
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill();
    });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
