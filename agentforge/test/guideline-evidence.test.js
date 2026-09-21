import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveGuidelineEvidence } from '../src/guidelineEvidence.js';

test('guideline retrieval ranks relevant synthetic evidence with provenance', () => {
  const result = retrieveGuidelineEvidence('diabetes medication follow-up');
  assert.equal(result.status, 'complete');
  assert.equal(result.evidence[0].source_type, 'guideline');
  assert.match(result.evidence[0].location, /^synthetic:\/\/guidelines\//);
  assert.ok(result.evidence[0].matched_terms.includes('diabetes'));
});

test('guideline retrieval qualifies empty or irrelevant questions', () => {
  assert.equal(retrieveGuidelineEvidence('').status, 'qualified');
  const result = retrieveGuidelineEvidence('volcano telemetry');
  assert.equal(result.status, 'qualified');
  assert.ok(result.issues.includes('insufficient_guideline_evidence'));
});

const root = new URL('../', import.meta.url);
const repoRoot = new URL('../../', import.meta.url);

test('follow-up evidence API separates patient facts from guideline evidence', async () => {
  const { spawn } = await import('node:child_process');
  const port = 18807;
  const child = spawn(process.execPath, ['agentforge/src/server.js'], { cwd: repoRoot, env: { ...process.env, PORT: String(port), AGENTFORGE_DEMO_SECRET: 'synthetic-test-secret', AGENTFORGE_SYNTHETIC_CONTEXT: 'true' }, stdio: ['ignore', 'ignore', 'ignore'] });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/ready`)).ok; } catch {}
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(ready, true);
    const context = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=fixture-patient-001`).then((response) => response.json());
    const response = await fetch(`http://127.0.0.1:${port}/v1/follow-up-evidence`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: context.demo_token, message: 'What should I review for diabetes medication follow-up?' }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ready');
    assert.equal(body.patient_facts[0].source_type, 'patient_record');
    assert.equal(body.guideline_evidence[0].source_type, 'guideline');
    assert.match(body.guideline_evidence[0].location, /^synthetic:\/\/guidelines\//);
  } finally {
    child.kill();
  }
});
