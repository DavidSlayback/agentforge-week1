import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCostUsd, isPriceEstimated, PRICE_TABLE } from '../src/pricing.js';

test('estimateCostUsd computes input+output cost from the price table', () => {
  const cost = estimateCostUsd('google/gemini-embedding-2', { inputTokens: 1_000_000, outputTokens: 0 });
  assert.equal(cost, PRICE_TABLE['google/gemini-embedding-2'].input_per_million_usd);
  const flashCost = estimateCostUsd('google/gemini-3.8-flash', { inputTokens: 500_000, outputTokens: 200_000 });
  const expected = 0.5 * PRICE_TABLE['google/gemini-3.8-flash'].input_per_million_usd + 0.2 * PRICE_TABLE['google/gemini-3.8-flash'].output_per_million_usd;
  assert.equal(cost >= 0, true);
  assert.ok(Math.abs(flashCost - expected) < 1e-9);
});

test('estimateCostUsd returns null, never a guessed price, for an unlisted model', () => {
  assert.equal(estimateCostUsd('google/some-future-model', { inputTokens: 100 }), null);
});

test('estimateCostUsd defaults to zero tokens', () => {
  assert.equal(estimateCostUsd('google/gemini-embedding-2'), 0);
});

test('every price table entry states its source and estimate flag; every claimed-confirmed price has a real URL source', () => {
  for (const [key, price] of Object.entries(PRICE_TABLE)) {
    assert.equal(typeof price.source, 'string', `${key} missing source`);
    assert.equal(typeof price.estimate, 'boolean', `${key} missing estimate flag`);
    if (!price.estimate) assert.match(price.source, /^https:\/\//, `${key} claims a confirmed price but its source is not a URL`);
  }
});

test('isPriceEstimated reports the estimate flag and null for unlisted keys', () => {
  assert.equal(isPriceEstimated('google/gemini-embedding-2'), false);
  assert.equal(isPriceEstimated('openrouter/qwen-default'), true);
  assert.equal(isPriceEstimated('unknown/model'), null);
});

test('the Gemini 3.8 Flash price-increase date and post-increase rates are recorded, not silently applied', () => {
  const flash = PRICE_TABLE['google/gemini-3.8-flash'];
  assert.equal(flash.price_increases_after, '2027-01-01');
  assert.equal(flash.price_after_increase.input_per_million_usd, 1.50);
  assert.equal(flash.price_after_increase.output_per_million_usd, 7.50);
  // estimateCostUsd always uses the current (pre-increase) numbers — it must
  // never silently switch rates based on the caller's clock.
  const cost = estimateCostUsd('google/gemini-3.8-flash', { inputTokens: 1_000_000, outputTokens: 0 });
  assert.equal(cost, flash.input_per_million_usd);
});
