import test from 'node:test';
import assert from 'node:assert/strict';
import { createCohereGuidelineRetriever, retrieveGuidelineEvidence } from '../src/guidelineEvidence.js';

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

test('Cohere retriever embeds synthetic corpus and query, reranks, and preserves provenance', async () => {
  const calls = [];
  const retriever = createCohereGuidelineRetriever({
    apiKey: 'unit-test-key',
    fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body);
      calls.push({ url, headers: options.headers, payload });
      if (url.endsWith('/v2/embed')) {
        const vectors = payload.texts.map((text) => text.toLowerCase().includes('diabetes') ? [1, 0] : [0, 1]);
        return { ok: true, json: async () => ({ embeddings: { float: vectors }, meta: { billed_units: { input_tokens: payload.texts.length } } }) };
      }
      return { ok: true, json: async () => ({ results: [{ index: 0, relevance_score: 0.98 }], meta: { billed_units: { search_units: 1 } } }) };
    },
  });
  const result = await retriever.retrieve('diabetes medication follow-up', { topK: 1 });
  assert.equal(result.status, 'complete');
  assert.equal(result.provider, 'cohere');
  assert.equal(result.evidence.length, 1);
  assert.match(result.evidence[0].location, /^synthetic:\/\/guidelines\//);
  assert.equal(calls.filter(({ url }) => url.endsWith('/v2/embed')).length, 2);
  assert.equal(calls.find(({ url }) => url.endsWith('/v2/rerank')).payload.model, 'rerank-v4.0-fast');
  assert.equal(calls.find(({ url }) => url.endsWith('/v2/rerank')).payload.query, 'synthetic diabetes follow-up documented glycemic values medication history');
  assert.ok(calls.every(({ headers }) => headers.authorization === 'Bearer unit-test-key'));
});

test('Cohere retriever requires a server-side key and sanitizes provider failures', async () => {
  assert.throws(() => createCohereGuidelineRetriever(), /COHERE_API_KEY_REQUIRED/);
  const retriever = createCohereGuidelineRetriever({ apiKey: 'unit-test-key', fetchImpl: async () => { throw new Error('secret-bearing network detail'); } });
  await assert.rejects(retriever.retrieve('diabetes follow-up'), /COHERE_REQUEST_FAILED/);
});

test('Cohere retriever does not transmit free-form unsupported user text', async () => {
  let calls = 0;
  const retriever = createCohereGuidelineRetriever({ apiKey: 'unit-test-key', fetchImpl: async () => { calls += 1; throw new Error('should not be called'); } });
  const result = await retriever.retrieve('Patient David Smith at 123 Example Street needs help with astronomy');
  assert.equal(result.status, 'qualified');
  assert.deepEqual(result.issues, ['no_approved_synthetic_query']);
  assert.equal(calls, 0);
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
