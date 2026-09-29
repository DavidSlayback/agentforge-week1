import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer, DEMO_KEY_REQUEST } from './helpers/testServer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('live OpenEMR mode disables fixture context and fixture UI paths', async () => {
  const port = 18798;
  const child = await startTestServer(port, { AGENTFORGE_SYNTHETIC_CONTEXT: '', AGENTFORGE_OPENEMR_MODE: 'live', AGENTFORGE_OPENEMR_BASE_URL: 'http://openemr', AGENTFORGE_OPENEMR_ACCESS_TOKEN: '' }, { path: '/health' });
  try {
    const context = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=fixture-patient-001`, DEMO_KEY_REQUEST);
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
