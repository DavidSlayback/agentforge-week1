const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const base = path.resolve(__dirname, '../..');

test('golden suite can evaluate the running AgentForge service', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-evals-'));
  const tracePath = path.join(root, 'traces.json');
  const child = spawn(process.execPath, ['agentforge/src/server.js'], {
    cwd: base,
    env: { ...process.env, PORT: '18788', AGENTFORGE_DEMO_SECRET: 'synthetic-test-secret', AGENTFORGE_SYNTHETIC_CONTEXT: 'true', AGENTFORGE_TRACE_PATH: tracePath },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        if ((await fetch('http://127.0.0.1:18788/ready')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(ready, true);
    const result = await new Promise((resolve, reject) => {
      const runner = spawn(process.execPath, ['evals/lib/runner.js', '--service', 'http://127.0.0.1:18788'], { cwd: base });
      let output = '';
      runner.stdout.on('data', (data) => { output += data; });
      runner.on('error', reject);
      runner.on('close', (code) => code ? reject(new Error(output)) : resolve(JSON.parse(output)));
    });
    assert.equal(result.total_cases, 7);
    assert.equal(result.passed_cases, 7);
    assert.equal(result.critical_failures, 0);
    assert.equal(result.gate_passed, true);
    const metrics = await (await fetch('http://127.0.0.1:18788/v1/metrics')).json();
    assert.equal(metrics.requests, 7);
    assert.ok(metrics.retrievalAttempts >= 7);
    const dashboard = await (await fetch('http://127.0.0.1:18788/observability')).text();
    assert.ok(dashboard.includes('AgentForge observability'));
    assert.ok(dashboard.includes("basePath+'/v1/metrics'"));
  } finally {
    child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
