import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './helpers/testServer.js';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const startServer = (port) => startTestServer(port);

const authorized = (patient_uuid, demo_token, extra = {}) => ({ patient_uuid, clinician_uuid: 'fixture-physician-001', demo_token, ...extra });

test('renders partial qualification and exposes a cross-patient block probe', async () => {
  const port = 18794;
  const child = await startServer(port);
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
    assert.match(page, /id="cross-patient-probe"/);
    assert.match(page, /Partial retrieval is qualified/);
    const context = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=fixture-patient-006`).then((response) => response.json());
    const partial = await fetch(`http://127.0.0.1:${port}/v1/briefings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(authorized('fixture-patient-006', context.demo_token, { case_id: 'partial_retrieval' })) }).then((response) => response.json());
    assert.equal(partial.disposition, 'partial');
    assert.equal(partial.qualification.required, true);
    assert.deepEqual(partial.withheld_fields, ['encounter_summary', 'note_summary']);
    const otherContext = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=fixture-patient-001`).then((response) => response.json());
    const blocked = await fetch(`http://127.0.0.1:${port}/v1/conversations/${partial.correlation_id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(authorized('fixture-patient-001', otherContext.demo_token, { message: 'What changed?' })) }).then((response) => response.json());
    assert.equal(blocked.disposition, 'blocked');
    assert.equal(blocked.patient, null);
    assert.deepEqual(blocked.claims, []);
    assert.match(blocked.qualification.reasons[0], /conversation_scope_invalid/);
    const malformed = await fetch(`http://127.0.0.1:${port}/v1/briefings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, 'invalid_json');
  } finally { child.kill(); }
});
