import test from 'node:test';
import assert from 'node:assert/strict';
import { buildW2GoldenSet, runW2RegressionGate, W2_GATE_CASE_COUNT, W2_GATE_LABELS } from '../src/w2RegressionGate.js';

test('W2 gate exposes a fixed 50-case corpus across all required rubrics', () => {
  const cases = buildW2GoldenSet();
  assert.equal(cases.length, W2_GATE_CASE_COUNT);
  assert.deepEqual([...new Set(cases.map((item) => item.label))].sort(), [...W2_GATE_LABELS].sort());
  assert.ok(cases.every((item) => item.synthetic_only === true));
});

test('W2 gate passes the reproducible baseline with per-rubric thresholds', () => {
  const result = runW2RegressionGate();
  assert.equal(result.passed, true);
  assert.equal(result.total_cases, 50);
  assert.equal(result.critical_failures.length, 0);
  assert.ok(Object.values(result.by_label).every((summary) => summary.rate >= 0.95));
  assert.equal(result.judge_config.per_label_min_rate, 0.95);
  assert.equal(result.judge_config.max_regression, 0.05);
});

test('W2 gate blocks an injected defect instead of warning', () => {
  const result = runW2RegressionGate({ injectDefect: true });
  assert.equal(result.passed, false);
  assert.ok(result.failed_cases.length > 0);
  assert.ok(result.regressions.schema_valid > 0.05);
});

test('W2 gate blocks corpus drift against the checked-in baseline', () => {
  const cases = buildW2GoldenSet();
  cases[0] = { ...cases[0], id: 'w2-golden-drifted' };
  const result = runW2RegressionGate({ cases });
  assert.equal(result.passed, false);
  assert.equal(result.baseline_mismatch, true);
});

test('W2 gate reports only redacted metadata, never document content', () => {
  const result = runW2RegressionGate();
  assert.equal(result.synthetic_only, true);
  assert.ok(!JSON.stringify(result).includes('patient raw'));
  assert.ok(!JSON.stringify(result).includes('LAB|'));
  assert.ok(result.results.every((item) => item.raw_content === undefined));
});
