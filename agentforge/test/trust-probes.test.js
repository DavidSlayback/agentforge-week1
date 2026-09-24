import test from 'node:test';
import assert from 'node:assert/strict';
import { runTrustProbes, probes } from '../scripts/trust-probes.mjs';

test('trust-probes: all adversarial claims are blocked', async () => {
  const results = await runTrustProbes();
  assert.equal(results.length, Object.keys(probes).length, `Expected ${Object.keys(probes).length} probes`);
  assert.ok(results.length >= 10, 'Must have at least 10 probes');

  const blockedCount = results.filter((r) => r.blocked).length;
  const blockRate = blockedCount / results.length;

  assert.equal(blockRate, 1.0, `Block rate must be 100%, got ${(blockRate * 100).toFixed(1)}%`);
  assert.ok(results.every((r) => r.legitSurvived), 'All legitimate claims should survive');
});

test('trust-probes: minimum 10 probes required', async () => {
  const results = await runTrustProbes();
  assert.ok(results.length >= 10, `Expected at least 10 probes, got ${results.length}`);
});
