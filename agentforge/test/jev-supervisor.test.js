import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJevSpikeCorpus, createJevDecisionRunner, runJevShadowReview, runJevSpike, JEV_SPIKE_CASE_COUNT } from '../src/jevSpike.js';

test('Jev spike uses a reproducible labeled corpus and keeps standard routing available', async () => {
  const corpus = buildJevSpikeCorpus();
  assert.equal(corpus.length, JEV_SPIKE_CASE_COUNT);
  assert.deepEqual([...new Set(corpus.map((item) => item.expected))].sort(), ['BLOCKED', 'CLARIFY', 'QUALIFIED', 'READY']);
  const result = await runJevSpike();
  assert.equal(result.synthetic_only, true);
  assert.equal(result.standard.accuracy, 1);
  assert.equal(result.jev.status, 'unavailable');
  assert.equal(result.recommendation, 'keep_standard');
  assert.ok(result.standard.rows.every((row) => row.run.traceable));
});

test('Jev adapter preserves typed output, applies the safety guard, and records service cost', async () => {
  const calls = [];
  const runner = createJevDecisionRunner({
    apiKey: 'test-only-key',
    endpoint: 'https://www.jevai.org/api/v1/decisions',
    mode: 'shadow',
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body), authorization: options.headers.authorization });
      return new Response(JSON.stringify({ code: 0, data: { answers: { route: { choice: 'READY', confidence: 0.81 } }, usage: { cost_usd: 0.02 } } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });
  const result = await runner(buildJevSpikeCorpus()[3]);
  assert.equal(result.final_state, 'BLOCKED');
  assert.equal(result.jev.raw_state, 'READY');
  assert.equal(result.jev.safety_override, true);
  assert.equal(result.cost_usd, 0.02);
  assert.equal(calls[0].body.state.safety_constraints.length, 3);
  assert.equal(calls[0].authorization, 'Bearer test-only-key');
});

test('Jev adapter stays disabled by default and rejects untrusted endpoints before sending the key', async () => {
  let called = false;
  const fakeFetch = async () => {
    called = true;
    return new Response('{}', { status: 200 });
  };
  const testCase = buildJevSpikeCorpus()[0];

  await assert.rejects(createJevDecisionRunner({ apiKey: 'test-only-key', fetchImpl: fakeFetch, mode: 'off' })(testCase), { error_class: 'jev_disabled' });
  await assert.rejects(createJevDecisionRunner({ apiKey: 'test-only-key', fetchImpl: fakeFetch, endpoint: 'http://www.jevai.org/api/v1/decisions', mode: 'shadow' })(testCase), { error_class: 'adapter_configuration_failure' });
  await assert.rejects(createJevDecisionRunner({ apiKey: 'test-only-key', fetchImpl: fakeFetch, endpoint: 'https://attacker.example/api/v1/decisions', mode: 'shadow' })(testCase), { error_class: 'adapter_configuration_failure' });
  await assert.rejects(createJevDecisionRunner({ apiKey: 'test-only-key', fetchImpl: fakeFetch, endpoint: 'https://www.jevai.org:8443/api/v1/decisions', mode: 'shadow' })(testCase), { error_class: 'adapter_configuration_failure' });
  assert.equal(called, false);
});

test('Jev spike separates adapter failures from service failures', async () => {
  const adapterFailure = await runJevSpike({ jevRunner: async () => { const error = new Error('bad typed answer'); error.error_class = 'adapter_failure'; throw error; } });
  assert.equal(adapterFailure.jev.rows[0].run.error_class, 'adapter_failure');

  const serviceFailure = await runJevSpike({ jevRunner: async () => { const error = new Error('provider unavailable'); error.error_class = 'service_failure'; throw error; } });
  assert.equal(serviceFailure.jev.rows[0].run.error_class, 'service_failure');
});

test('mock-only shadow seam is off by default and cannot replace deterministic state', async () => {
  const baseline = { final_state: 'CLARIFY', typed_outputs: { evidence: { status: 'missing' } } };
  let calls = 0;
  const off = await runJevShadowReview({ baseline, jevRunner: async () => { calls += 1; return { final_state: 'READY' }; } });
  assert.equal(off.status, 'off');
  assert.equal(off.deterministic_state, 'CLARIFY');
  assert.equal(calls, 0);

  const blocked = await runJevShadowReview({ baseline, mode: 'shadow', jevRunner: async () => { calls += 1; return { final_state: 'READY' }; } });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.error_class, 'synthetic_evidence_required');
  assert.equal(calls, 0);
});

test('synthetic shadow captures redacted comparison metadata and omits raw errors', async () => {
  const baseline = { final_state: 'BLOCKED', typed_outputs: { evidence: { status: 'ready', guideline_evidence: [{ source_id: 'x' }] } } };
  const compared = await runJevShadowReview({ baseline, mode: 'shadow', syntheticOnly: true, jevRunner: async () => ({ final_state: 'READY', cost_usd: 0.01, jev: { safety_override: true }, typed_outputs: { evidence: { quote: 'must not escape' } } }) });
  assert.equal(compared.deterministic_state, 'BLOCKED');
  assert.equal(compared.jev_state, 'READY');
  assert.equal(compared.safety_override, true);
  assert.equal(compared.deterministic_prevailed, true);
  assert.equal(compared.cost_usd, 0.01);
  assert.equal(JSON.stringify(compared).includes('must not escape'), false);

  const failure = await runJevShadowReview({ baseline, mode: 'shadow', syntheticOnly: true, jevRunner: async () => { const error = new Error('sensitive raw provider body'); error.error_class = 'service_failure'; throw error; } });
  assert.equal(failure.error_class, 'service_failure');
  assert.equal(JSON.stringify(failure).includes('sensitive raw provider body'), false);
});

test('mock Jev READY cannot upgrade deterministic missing-evidence state', async () => {
  const baseline = { final_state: 'CLARIFY', typed_outputs: { evidence: { output_status: 'qualified', patient_facts: [], guideline_evidence: [], qualification: { required: true, reasons: ['missing_evidence'] } } } };
  let received;
  const compared = await runJevShadowReview({ baseline, mode: 'shadow', syntheticOnly: true, jevRunner: async (testCase) => { received = testCase; return { final_state: 'READY' }; } });
  assert.equal(received.evidence.status, 'qualified');
  assert.equal(compared.jev_state, 'READY');
  assert.equal(compared.deterministic_state, 'CLARIFY');
  assert.equal(compared.safety_override, true);
  assert.equal(compared.deterministic_prevailed, true);
});
