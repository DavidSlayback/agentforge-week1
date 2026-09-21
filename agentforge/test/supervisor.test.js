import test from 'node:test';
import assert from 'node:assert/strict';
import { runDeterministicSupervisor, SUPERVISOR_STATES } from '../src/supervisor.js';

const evidence = (overrides = {}) => ({ status: 'ready', patient_facts: [{ source_type: 'patient_record', patient_ref: 'fixture-patient-001', source_id: 'problem-1', field: 'problem.diabetes.status', value: 'active' }], guideline_evidence: [{ source_type: 'guideline', source_id: 'guideline-1', title: 'Synthetic guideline', version: '2026.1', section: 'Review', location: 'synthetic://guidelines/one#review', quote: 'Review documented evidence.', matched_terms: ['review'] }], retrieval: { guideline_status: 'complete', guideline_issues: [], failed_patient_groups: [] }, qualification: { required: false, reasons: [] }, ...overrides });

test('deterministic supervisor records typed worker handoffs and readiness', () => {
  const result = runDeterministicSupervisor({ intakeResult: { status: 'complete', facts: [] }, evidenceResult: evidence() });
  assert.equal(result.final_state, SUPERVISOR_STATES.READY);
  assert.equal(result.readiness, 'ready');
  assert.deepEqual(result.handoffs.map((handoff) => handoff.worker), ['intake-extractor', 'evidence-retriever', 'deterministic-verifier']);
  assert.ok(result.transitions.includes('VERIFY'));
});

test('deterministic supervisor qualifies incomplete evidence and blocks unsafe or uncited output', () => {
  assert.equal(runDeterministicSupervisor({ evidenceResult: evidence({ qualification: { required: true, reasons: ['insufficient_guideline_evidence'] } }) }).final_state, SUPERVISOR_STATES.QUALIFIED);
  assert.equal(runDeterministicSupervisor({ evidenceResult: evidence(), unsafe: true }).final_state, SUPERVISOR_STATES.BLOCKED);
  assert.equal(runDeterministicSupervisor({ evidenceResult: evidence({ guideline_evidence: [{ source_type: 'guideline', source_id: 'g' }] }) }).final_state, SUPERVISOR_STATES.BLOCKED);
  assert.equal(runDeterministicSupervisor({ evidenceResult: null }).final_state, SUPERVISOR_STATES.CLARIFY);
});

test('supervisor API returns an inspectable synthetic workflow', async () => {
  const { spawn } = await import('node:child_process');
  const port = 18808;
  const repoRoot = new URL('../../', import.meta.url);
  const child = spawn(process.execPath, ['agentforge/src/server.js'], { cwd: repoRoot, env: { ...process.env, PORT: String(port), AGENTFORGE_DEMO_SECRET: 'synthetic-test-secret', AGENTFORGE_SYNTHETIC_CONTEXT: 'true' }, stdio: ['ignore', 'ignore', 'ignore'] });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
      try { ready = (await fetch(`http://127.0.0.1:${port}/ready`)).ok; } catch {}
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(ready, true);
    const context = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=fixture-patient-001`).then((response) => response.json());
    const response = await fetch(`http://127.0.0.1:${port}/v1/supervisor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: context.demo_token, message: 'Review diabetes medication follow-up.' }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(['READY', 'QUALIFIED'].includes(body.final_state));
    assert.ok(body.handoffs.some((handoff) => handoff.worker === 'evidence-retriever'));
  } finally {
    child.kill();
  }
});
