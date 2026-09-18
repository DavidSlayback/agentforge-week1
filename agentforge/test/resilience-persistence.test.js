import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const agentforgeRoot = fileURLToPath(new URL('..', import.meta.url));
const port = 18796;

async function startServer(tracePath) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: agentforgeRoot,
    env: { ...process.env, PORT: String(port), AGENTFORGE_DEMO_SECRET: '', AGENTFORGE_TRACE_PATH: tracePath },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/ready`)).ok) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill();
  throw new Error('AgentForge persistence test server did not become ready');
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
  });
}

test('redacted traces survive a service restart through the configured store', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentforge-restart-'));
  const tracePath = path.join(root, 'traces.json');
  let child;
  try {
    child = await startServer(tracePath);
    const response = await fetch(`http://127.0.0.1:${port}/v1/briefings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        patient_uuid: 'fixture-patient-001',
        case_id: 'complete_return_visit',
        clinician_uuid: 'fixture-physician-001',
        authorization: { status: 'authorized', scope: 'read-briefing' },
      }),
    });
    assert.equal(response.status, 200);
    const beforeRestart = await fetch(`http://127.0.0.1:${port}/v1/traces`).then((result) => result.json());
    assert.equal(beforeRestart.length, 1);
    assert.equal(beforeRestart[0].scope.patientRef, '[REDACTED]');
    await stopServer(child);

    child = await startServer(tracePath);
    const afterRestart = await fetch(`http://127.0.0.1:${port}/v1/traces`).then((result) => result.json());
    assert.equal(afterRestart.length, 1);
    assert.equal(afterRestart[0].correlationId, beforeRestart[0].correlationId);
    assert.equal(afterRestart[0].scope.patientRef, '[REDACTED]');
  } finally {
    await stopServer(child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
