import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function startServer(port) {
  const child = spawn(process.execPath, ['agentforge/src/server.js'], { cwd: base, env: { ...process.env, PORT: String(port), AGENTFORGE_DEMO_SECRET: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/ready`)).ok) return child; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  child.kill();
  throw new Error('AgentForge test server did not become ready');
}

const authorized = (patient_uuid, extra = {}) => ({ patient_uuid, clinician_uuid: 'fixture-physician-001', authorization: { status: 'authorized', scope: 'read-briefing' }, ...extra });

test('renders partial qualification and exposes a cross-patient block probe', async () => {
  const port = 18794;
  const child = await startServer(port);
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
    assert.match(page, /id="cross-patient-probe"/);
    assert.match(page, /Partial retrieval is qualified/);
    const partial = await fetch(`http://127.0.0.1:${port}/v1/briefings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(authorized('fixture-patient-006', { case_id: 'partial_retrieval' })) }).then((response) => response.json());
    assert.equal(partial.disposition, 'partial');
    assert.equal(partial.qualification.required, true);
    assert.deepEqual(partial.withheld_fields, ['encounter_summary', 'note_summary']);
    const blocked = await fetch(`http://127.0.0.1:${port}/v1/conversations/${partial.correlation_id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(authorized('fixture-patient-001', { message: 'What changed?' })) }).then((response) => response.json());
    assert.equal(blocked.disposition, 'blocked');
    assert.equal(blocked.patient, null);
    assert.deepEqual(blocked.claims, []);
    assert.match(blocked.qualification.reasons[0], /conversation_scope_invalid/);
    const malformed = await fetch(`http://127.0.0.1:${port}/v1/briefings`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error, 'invalid_json');
  } finally { child.kill(); }
});
