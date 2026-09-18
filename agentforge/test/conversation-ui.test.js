import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function startServer(port) {
  const child = spawn(process.execPath, ['agentforge/src/server.js'], {
    cwd: base,
    env: { ...process.env, PORT: String(port), AGENTFORGE_DEMO_SECRET: '' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/ready`)).ok) return child;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  child.kill();
  throw new Error('AgentForge test server did not become ready');
}

test('serves a conversation surface with safe follow-up prompts', async () => {
  const port = 18789;
  const child = await startServer(port);
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`).then((response) => {
      assert.equal(response.status, 200);
      return response.text();
    });
    assert.match(page, /id="conversation-heading"/);
    assert.match(page, /id="followup-form"/);
    assert.match(page, /What changed since the last visit\?/);
    assert.match(page, /What plan items need follow-through\?/);
    assert.match(page, /Which records conflict\?/);
    assert.match(page, /demoToken: ""/);
    assert.doesNotMatch(page, /demoToken: token/);
    assert.doesNotMatch(page, /request\(basePath \+ '\/v1\/conversations/);
    assert.match(page, /request\('\/v1\/conversations/);
    assert.match(page, /state\.demoToken = ''/);
    assert.doesNotMatch(page, /<pre id="out">/);

    const briefing = await fetch(`http://127.0.0.1:${port}/v1/briefings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        patient_uuid: 'fixture-patient-001',
        case_id: 'complete_return_visit',
        clinician_uuid: 'fixture-physician-001',
        authorization: { status: 'authorized', scope: 'read-briefing' },
      }),
    }).then((response) => response.json());
    assert.equal(briefing.disposition, 'complete');
    assert.ok(briefing.correlation_id);

    const followUp = await fetch(`http://127.0.0.1:${port}/v1/conversations/${encodeURIComponent(briefing.correlation_id)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        patient_uuid: 'fixture-patient-001',
        message: 'What changed since the last visit?',
        clinician_uuid: 'fixture-physician-001',
        authorization: { status: 'authorized', scope: 'read-briefing' },
      }),
    }).then((response) => response.json());
    assert.equal(followUp.contract_version, '0.1');
    assert.equal(followUp.correlation_id, briefing.correlation_id);
    assert.equal(followUp.patient.patient_ref, 'fixture-patient-001');
    assert.match(followUp.text, /Follow-up for fixture-patient-001/);
    assert.equal(followUp.verification.status, 'passed');
  } finally {
    child.kill();
  }
});
