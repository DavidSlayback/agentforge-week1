import test from 'node:test';
import assert from 'node:assert/strict';
import { DeterministicProvider, ResilientProvider } from '../src/modelProvider.js';
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
  assert.match(result.text, /Synthetic Patient/);
});

test('deterministic provider remains a ready fallback', async () => {
  const provider = new ResilientProvider({ primary: new FailingProvider(), fallback: new DeterministicProvider() });
  assert.equal(await provider.checkReady(), true);
});

test('unsafe or ungrounded live output is rejected before display and falls back', async () => {
  const primary = { name: 'live-fixture', model: 'unsafe-fixture', async checkReady() { return true; }, async generate() { return { text: 'Recommend increasing the medication immediately.', inputTokens: 10, outputTokens: 8, estimatedCostUsd: 0.01 }; } };
  const claims = [{ field: 'problem.hypertension.status', value: 'active' }];
  const provider = new ResilientProvider({ primary, fallback: new DeterministicProvider(), maxRetries: 0 });
  const result = await provider.generate({ patient: { display_name: 'Synthetic Patient' }, claims, qualification: { required: false } }, { validate: (candidate) => verifyGeneratedText({ text: candidate.text, claims }) });
  assert.equal(result.provider_fallback, true);
  assert.match(result.text, /problem\.hypertension\.status/);
  assert.equal(result.provider_error_code, 'MODEL_OUTPUT_REJECTED');
});
