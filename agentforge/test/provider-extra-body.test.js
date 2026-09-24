import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIResponsesProvider } from '../src/modelProvider.js';

function capturingFetch() {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ output_text: 'OK', usage: { input_tokens: 1, output_tokens: 1 } }) };
  };
  return { bodies, fetchImpl };
}

test('responses provider sends configured extra body fields (Qwen enable_thinking=false)', async () => {
  const { bodies, fetchImpl } = capturingFetch();
  const provider = new OpenAIResponsesProvider({ endpoint: 'https://example.test/v1/responses', apiKey: 'k', model: 'qwen3.8-max', fetchImpl, extraBody: { enable_thinking: false } });
  await provider.generate({ prompt: 'hi', maxTokens: 2000 });
  assert.equal(bodies[0].enable_thinking, false);
  assert.equal(bodies[0].model, 'qwen3.8-max');
  assert.equal(bodies[0].max_output_tokens, 2000);
});

test('responses provider sends no extra fields by default', async () => {
  const { bodies, fetchImpl } = capturingFetch();
  const provider = new OpenAIResponsesProvider({ endpoint: 'https://example.test/v1/responses', apiKey: 'k', model: 'm', fetchImpl });
  await provider.generate({ prompt: 'hi' });
  assert.equal('enable_thinking' in bodies[0], false);
});
