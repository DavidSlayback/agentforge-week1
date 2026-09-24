import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './helpers/testServer.js';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const startServer = (port) => startTestServer(port);

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
    assert.match(page, /Test Empty · successful empty lookup/);
    assert.match(page, /Test No Baseline · no prior comparison/);
    assert.match(page, /Normalized facts/);
    assert.match(page, /Source records/);
    assert.match(page, /Open operations dashboard/);
    assert.match(page, /demoToken: ""/);
    assert.doesNotMatch(page, /demoToken: token/);
    assert.doesNotMatch(page, /request\(basePath \+ '\/v1\/conversations/);
    assert.match(page, /request\('\/v1\/conversations/);
    assert.match(page, /state\.demoToken = ''/);
    assert.match(page, /authorizedRequest\(\{ patient_uuid: otherPatient, message: 'What changed\?' \}, false\)/);
    assert.doesNotMatch(page, /<pre id="out">/);

    const context = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=fixture-patient-001`).then((response) => response.json());
    const briefing = await fetch(`http://127.0.0.1:${port}/v1/briefings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        patient_uuid: 'fixture-patient-001',
        clinician_uuid: 'fixture-physician-001',
        demo_token: context.demo_token,
      }),
    }).then((response) => response.json());
    assert.equal(briefing.disposition, 'complete');
    assert.ok(briefing.correlation_id);
    assert.equal(briefing.comparison.changes.length, 1);

    const followUp = await fetch(`http://127.0.0.1:${port}/v1/conversations/${encodeURIComponent(briefing.correlation_id)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        patient_uuid: 'fixture-patient-001',
        message: 'What changed since the last visit?',
        clinician_uuid: 'fixture-physician-001',
        demo_token: context.demo_token,
      }),
    }).then((response) => response.json());
    assert.equal(followUp.contract_version, '0.1');
    assert.equal(followUp.correlation_id, briefing.correlation_id);
    assert.equal(followUp.patient.patient_ref, 'fixture-patient-001');
    assert.match(followUp.text, /changed from 5 mg daily .* to 10 mg daily/i);
    assert.equal(followUp.verification.status, 'passed');
  } finally {
    child.kill();
  }
});
