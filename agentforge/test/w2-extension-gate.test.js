import test from 'node:test';
import assert from 'node:assert/strict';
import { clickToSourceIssues } from '../src/extensionCases/clickToSource.js';
import { buildW2ExtensionSet, runW2ExtensionGate } from '../src/w2ExtensionGate.js';
import { W2_GATE_LABELS, kase, scan } from '../src/w2RegressionGate.js';

test('the extension suite is non-empty and uses only the five W2 labels', () => {
  const cases = buildW2ExtensionSet();
  assert.ok(cases.length > 0);
  for (const testCase of cases) {
    assert.ok(W2_GATE_LABELS.includes(testCase.category), testCase.id);
    assert.equal(typeof testCase.guards_against, 'string');
  }
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, 'case ids are unique');
});

test('the committed extension suite passes against its baseline', async () => {
  const result = await runW2ExtensionGate();
  assert.equal(result.missing_baseline, false);
  assert.equal(result.baseline_mismatch, false);
  assert.deepEqual(result.failed_cases, []);
  assert.equal(result.passed, true);
});

test('the injected defect and a missing baseline both fail the extension gate', async () => {
  assert.equal((await runW2ExtensionGate({ injectDefect: true })).passed, false);
  const noBaseline = await runW2ExtensionGate({ baseline: null });
  assert.equal(noBaseline.missing_baseline, true);
  assert.equal(noBaseline.passed, false);
});

test('an empty extension suite fails instead of passing vacuously', async () => {
  const result = await runW2ExtensionGate({ cases: [], baseline: { corpus_sha256: null, by_label: {} } });
  assert.equal(result.thresholds_passed, false);
  assert.equal(result.passed, false);
});

test('a failing expect.custom check fails its case and the gate', async () => {
  const failing = kase('x0-custom-fails', 'schema_valid', 'expect.custom issues are ignored by the runner.', scan('lab-a', 'lab_pdf'), { custom: async () => ['planted_issue'] });
  const result = await runW2ExtensionGate({ cases: [failing], baseline: { corpus_sha256: null, by_label: {} } });
  assert.deepEqual(result.failed_cases.map((c) => [c.id, c.issues]), [['x0-custom-fails', ['planted_issue']]]);
  assert.equal(result.passed, false);
});

test('clickToSourceIssues flags a link without a box and a cited fact without a box', () => {
  const extraction = { facts: [{ field_id: 'lab.hgb.value', citation: { field_or_chunk_id: 'lab.hgb.value', bounding_box: [1, 2, 3, 4] } }] };
  const good = '<div class="pdf-page"><div class="page-overlay"><a class="source-box source-box--verified" id="box-lab-hgb-value" href="#row-lab-hgb-value"></a></div></div><article id="row-lab-hgb-value"><a class="citation-source-link" href="#box-lab-hgb-value">View</a></article>';
  assert.deepEqual(clickToSourceIssues(good, extraction), []);
  const brokenLink = good.replace('href="#box-lab-hgb-value">View', 'href="#box-missing">View');
  assert.ok(clickToSourceIssues(brokenLink, extraction).includes('link_without_box:box-missing'));
  const noBox = good.replace(/<a class="source-box[^>]*><\/a>/, '');
  assert.ok(clickToSourceIssues(noBox, extraction).includes('cited_fact_without_box:lab.hgb.value'));
});
