import test from 'node:test';
import assert from 'node:assert/strict';
import { DashScopeMultimodalProvider, DeterministicProvider, OpenAIResponsesProvider, ResilientProvider } from '../src/modelProvider.js';
import { verifyGeneratedText } from '../src/verifier.js';

class FailingProvider {
  name = 'test-provider';
  model = 'failure-fixture';
  attempts = 0;
  async checkReady() { return true; }
  async generate() { this.attempts += 1; throw new Error('MODEL_TIMEOUT'); }
}

test('provider failure retries twice then falls back deterministically', async () => {
  const primary = new FailingProvider();
  const retries = [];
  const provider = new ResilientProvider({ primary, fallback: new DeterministicProvider(), maxRetries: 2 });
  const result = await provider.generate({ patient: { display_name: 'Synthetic Patient' }, claims: [], qualification: { required: false } }, { trace: { recordRetry: (value) => retries.push(value) } });
  assert.equal(primary.attempts, 3);
  assert.equal(retries.length, 3);
  assert.equal(result.provider_fallback, true);
  assert.equal(result.provider_error_code, 'MODEL_TIMEOUT');
  assert.equal(await provider.checkReady(), false);
  assert.match(result.text, /Synthetic Patient/);
});

test('configured primary outage makes readiness not ready even when fallback can serve', async () => {
  const provider = new ResilientProvider({ primary: new FailingProvider(), fallback: new DeterministicProvider() });
  assert.equal(await provider.checkReady(), true);
  provider.primary.checkReady = async () => false;
  assert.equal(await provider.checkReady(), false);
});

test('unsafe or ungrounded live output is rejected before display and falls back', async () => {
  const primary = { name: 'live-fixture', model: 'unsafe-fixture', async checkReady() { return true; }, async generate() { return { text: 'Recommend increasing the medication immediately.', inputTokens: 10, outputTokens: 8, estimatedCostUsd: 0.01 }; } };
  const claims = [{ field: 'problem.hypertension.status', value: 'active' }];
  const provider = new ResilientProvider({ primary, fallback: new DeterministicProvider(), maxRetries: 0 });
  const result = await provider.generate({ patient: { display_name: 'Synthetic Patient' }, claims, qualification: { required: false } }, { validate: (candidate) => verifyGeneratedText({ text: candidate.text, claims }) });
  assert.equal(result.provider_fallback, true);
  assert.match(result.text, /problem\.hypertension\.status/);
  assert.equal(result.provider_error_code, 'MODEL_OUTPUT_REJECTED');
  assert.equal(result.provider_name, 'deterministic');
  assert.equal(result.model_name, 'fixture-v1');
});

test('DashScope multimodal provider uses a text content part and normalizes response usage', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_endpoint, options) => {
    request = { endpoint: _endpoint, headers: options.headers, body: JSON.parse(options.body) };
    return { ok: true, async json() { return { output: { choices: [{ message: { content: [{ text: 'grounded synthetic answer' }] } }] }, usage: { input_tokens: 12, output_tokens: 7 } }; } };
  };
  try {
    const provider = new DashScopeMultimodalProvider({ endpoint: 'https://example.invalid/generation', apiKey: 'test-secret', model: 'qwen3.5-flash' });
    const result = await provider.generate({ prompt: 'synthetic prompt' });
    assert.equal(result.text, 'grounded synthetic answer');
    assert.equal(result.inputTokens, 12);
    assert.equal(result.outputTokens, 7);
    assert.equal(request.body.model, 'qwen3.5-flash');
    assert.deepEqual(request.body.input.messages[0].content, [{ text: 'synthetic prompt' }]);
    assert.equal(request.body.parameters.result_format, 'message');
    assert.equal(request.headers.authorization, 'Bearer test-secret');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI Responses provider uses Bailian-compatible input and output shape', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (_endpoint, options) => {
    request = { endpoint: _endpoint, headers: options.headers, body: JSON.parse(options.body) };
    return { ok: true, async json() { return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'responses synthetic answer' }] }], usage: { input_tokens: 9, output_tokens: 6 } }; } };
  };
  try {
    const provider = new OpenAIResponsesProvider({ endpoint: 'https://example.invalid/compatible-mode/v1/responses', apiKey: 'test-secret', model: 'qwen3.5-flash' });
    const result = await provider.generate({ prompt: 'synthetic prompt' });
    assert.equal(result.text, 'responses synthetic answer');
    assert.equal(result.inputTokens, 9);
    assert.equal(result.outputTokens, 6);
    assert.equal(request.body.model, 'qwen3.5-flash');
    assert.deepEqual(request.body.input[0].content, [{ type: 'input_text', text: 'synthetic prompt' }]);
    assert.equal(request.headers.authorization, 'Bearer test-secret');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
