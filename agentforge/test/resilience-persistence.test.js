import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './helpers/testServer.js';

const agentforgeRoot = fileURLToPath(new URL('..', import.meta.url));
const port = 18796;

const startServer = (tracePath) => startTestServer(port, { AGENTFORGE_TRACE_PATH: tracePath });

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
    const context = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=fixture-patient-001`).then((result) => result.json());
    const response = await fetch(`http://127.0.0.1:${port}/v1/briefings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        patient_uuid: 'fixture-patient-001',
        case_id: 'complete_return_visit',
        clinician_uuid: 'fixture-physician-001',
        demo_token: context.demo_token,
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
