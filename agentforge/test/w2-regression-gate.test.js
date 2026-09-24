import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildW2GoldenSet, phiIdentifiers, runW2RegressionGate, W2_GATE_CASE_COUNT, W2_GATE_LABELS, withCapturedOutput, goldenCorpusHash, JUDGE_CONFIG } from '../src/w2RegressionGate.js';

const truthDir = new URL('./fixtures/golden/truth/', import.meta.url);

test('W2 gate has 50 distinct cases in every category, each documenting its failure mode', () => {
  const cases = buildW2GoldenSet();
  assert.equal(cases.length, W2_GATE_CASE_COUNT);
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);
  // At most 19 per category, so a single failing case drops the rate below 95%.
  for (const label of W2_GATE_LABELS) {
    const count = cases.filter((item) => item.category === label).length;
    assert.ok(count >= 5 && count <= 19, `${label} has ${count} cases`);
  }
  for (const item of cases) {
    assert.equal(item.synthetic_only, true);
    assert.ok(item.guards_against.length > 20, `${item.id} must state the failure mode it guards`);
    assert.ok(['scan', 'text_supervisor', 'text_lab_evidence'].includes(item.scenario.kind), `${item.id} must run a service workflow`);
  }
  assert.equal(new Set(cases.map((item) => JSON.stringify([item.scenario, item.expect]))).size, cases.length, 'no two cases may be the same scenario with the same assertions');
});

test('W2 gate passes the committed baseline with per-category thresholds', async () => {
  const result = await runW2RegressionGate();
  assert.deepEqual(result.failed_cases, []);
  assert.equal(result.passed, true);
  assert.equal(result.baseline_mismatch, false);
  assert.equal(result.total_cases, 50);
  assert.ok(Object.values(result.by_label).every((summary) => summary.rate >= 0.95));
  assert.equal(result.judge_config.per_label_min_rate, 0.95);
  assert.equal(result.judge_config.max_regression, 0.05);
});

test('W2 gate blocks an injected defect instead of warning', async () => {
  const result = await runW2RegressionGate({ injectDefect: true });
  assert.equal(result.passed, false);
  assert.ok(result.regressions.schema_valid > 0.05);
});

test('W2 gate blocks case-set drift against the committed baseline', async () => {
  const cases = buildW2GoldenSet();
  cases[0] = { ...cases[0], id: 'sv-01-drifted' };
  const result = await runW2RegressionGate({ cases });
  assert.equal(result.passed, false);
  assert.equal(result.thresholds_passed, true);
  assert.equal(result.baseline_mismatch, true);
});

test('W2 gate fails a category that drops by more than 5 points against the baseline', async () => {
  const baseline = JSON.parse(fs.readFileSync(new URL('../../docs/agentforge/evidence/W2_BASELINE_REPORT.json', import.meta.url), 'utf8'));
  const cases = buildW2GoldenSet();
  const index = cases.findIndex((item) => item.id === 'fc-01-lab-a-values');
  cases[index] = { ...cases[index], expect: { lab_facts: {}, workflow: { final_state: 'BLOCKED' } } };
  const result = await runW2RegressionGate({ cases, baseline: { ...baseline, corpus_sha256: 'ignored' } });
  assert.equal(result.passed, false);
  assert.equal(result.by_label.factually_consistent.rate, 0.9);
  assert.equal(result.regressions.factually_consistent, 0.1);
});

test('W2 gate report carries only codes, never the synthetic identifiers it checks for', async () => {
  const result = await runW2RegressionGate({ injectDefect: true });
  const serialized = JSON.stringify(result);
  for (const name of fs.readdirSync(truthDir)) {
    const { words } = phiIdentifiers(JSON.parse(fs.readFileSync(new URL(name, truthDir), 'utf8')));
    for (const word of words) assert.ok(!serialized.toLowerCase().includes(word.toLowerCase()), `${name} identifier leaked into the gate report`);
  }
});

test('overlapping output-capture sessions restore the real console and stdout', async () => {
  const originals = { log: console.log, error: console.error, stdout: process.stdout.write, stderr: process.stderr.write };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = withCapturedOutput(async () => { console.log('first-session'); await gate; return 1; });
  const second = withCapturedOutput(async () => { console.log('second-session'); return 2; });
  const secondResult = await second;
  assert.equal(console.log === originals.log, false, 'capture must stay installed while the first session is open');
  release();
  const firstResult = await first;
  assert.equal(console.log, originals.log);
  assert.equal(console.error, originals.error);
  assert.equal(process.stdout.write, originals.stdout);
  assert.equal(process.stderr.write, originals.stderr);
  assert.match(firstResult.output, /first-session/);
  assert.match(firstResult.output, /second-session/);
  assert.equal(secondResult.value, 2);
});

test('loosening a threshold or the case count changes the case-set hash', () => {
  const cases = buildW2GoldenSet();
  const base = goldenCorpusHash(cases);
  assert.notEqual(goldenCorpusHash(cases, { judge: { ...JUDGE_CONFIG, per_label_min_rate: 0.9 } }), base);
  assert.notEqual(goldenCorpusHash(cases, { judge: { ...JUDGE_CONFIG, max_regression: 0.2 } }), base);
  assert.notEqual(goldenCorpusHash(cases, { caseCount: 40 }), base);
});
