import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJevSpikeCorpus, createJevDecisionRunner, runJevSpike, JEV_SPIKE_CASE_COUNT } from '../src/jevSpike.js';

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
    endpoint: 'https://jev.test/api/v1/decisions',
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

test('Jev spike separates adapter failures from service failures', async () => {
  const adapterFailure = await runJevSpike({ jevRunner: async () => { const error = new Error('bad typed answer'); error.error_class = 'adapter_failure'; throw error; } });
  assert.equal(adapterFailure.jev.rows[0].run.error_class, 'adapter_failure');

  const serviceFailure = await runJevSpike({ jevRunner: async () => { const error = new Error('provider unavailable'); error.error_class = 'service_failure'; throw error; } });
  assert.equal(serviceFailure.jev.rows[0].run.error_class, 'service_failure');
});

