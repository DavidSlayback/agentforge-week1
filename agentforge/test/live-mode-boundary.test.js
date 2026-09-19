import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('live OpenEMR mode disables fixture context and fixture UI paths', async () => {
  const port = 18798;
  const child = spawn(process.execPath, ['agentforge/src/server.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), AGENTFORGE_DEMO_SECRET: 'synthetic-test-secret', AGENTFORGE_OPENEMR_MODE: 'live', AGENTFORGE_OPENEMR_BASE_URL: 'http://openemr', AGENTFORGE_OPENEMR_ACCESS_TOKEN: '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  try {
    let health;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try { health = await fetch(`http://127.0.0.1:${port}/health`); if (health.ok) break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(health?.status, 200);
    const context = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=fixture-patient-001`);
    assert.equal(context.status, 404);
    const page = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
    assert.match(page, /Open this page from an authenticated OpenEMR patient chart/);
    assert.doesNotMatch(page, /fixture-patient|fixture-physician/);
    const bodyOnly = await fetch(`http://127.0.0.1:${port}/v1/briefings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: 'patient-uuid', clinician_uuid: 'clinician-uuid', authorization: { status: 'authorized', scope: 'read-briefing' }, correlation_id: 'live-body-only' }) });
    assert.equal(bodyOnly.status, 400);
    assert.equal((await bodyOnly.json()).error, 'invalid_prepare_request');
    const forged = await fetch(`http://127.0.0.1:${port}/v1/briefings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: 'patient-uuid', clinician_uuid: 'clinician-uuid', demo_token: 'copied-payload.without-server-verification' }) });
    assert.equal(forged.status, 403);
  } finally {
    child.kill();
  }
});
