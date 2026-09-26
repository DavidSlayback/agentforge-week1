import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadGuidelineCorpus } from '../src/guidelineEvidence.js';
import { loadRetrievalBenchmark, recallAtK, reciprocalRankAtK, summarizeStage } from '../src/retrievalBenchmark.js';

test('recallAtK caps the denominator at k so a query with many relevant chunks can still score 1', () => {
  assert.equal(recallAtK(['a', 'b', 'c'], ['a', 'b', 'c', 'd', 'e'], 3), 1);
  assert.equal(recallAtK(['a', 'x', 'y'], ['a', 'b', 'c', 'd'], 3), 1 / 3);
  assert.equal(recallAtK(['x', 'a', 'y'], ['a'], 3), 1);
  assert.equal(recallAtK(['x', 'y', 'z', 'a'], ['a'], 3), 0, 'a hit below rank k does not count');
  assert.equal(recallAtK([], ['a'], 3), 0);
  assert.equal(recallAtK(['a', 'b'], ['a', 'b'], 3), 1);
});

test('reciprocalRankAtK is 1/rank of the first relevant id within k, else 0', () => {
  assert.equal(reciprocalRankAtK(['a', 'b', 'c'], ['a'], 3), 1);
  assert.equal(reciprocalRankAtK(['x', 'b', 'c'], ['b', 'c'], 3), 1 / 2);
  assert.equal(reciprocalRankAtK(['x', 'y', 'c'], ['c'], 3), 1 / 3);
  assert.equal(reciprocalRankAtK(['x', 'y', 'z', 'c'], ['c'], 3), 0);
  assert.equal(reciprocalRankAtK([], ['c'], 3), 0);
});

test('summarizeStage averages only measured queries and counts the unmeasured ones separately', () => {
  const summary = summarizeStage([
    { id: 'q1', measured: true, ranked: ['a', 'x', 'y'], relevant: ['a'] },
    { id: 'q2', measured: true, ranked: ['x', 'y', 'b'], relevant: ['b'] },
    { id: 'q3', measured: false, ranked: [], relevant: ['c'] },
  ], { k: 3 });
  assert.equal(summary.measured, 2);
  assert.equal(summary.unmeasured, 1);
  assert.equal(summary.recall_at_3, 1);
  assert.equal(summary.mrr_at_3, (1 + 1 / 3) / 2);
  assert.equal(summary.hit_at_1, 0.5);
});

test('summarizeStage reports null metrics, never 0, when nothing was measured', () => {
  const summary = summarizeStage([{ id: 'q1', measured: false, ranked: [], relevant: ['a'] }], { k: 3 });
  assert.equal(summary.measured, 0);
  assert.equal(summary.recall_at_3, null);
  assert.equal(summary.mrr_at_3, null);
});

test('the committed benchmark labels only name real corpus chunks and every query has at least one', () => {
  const benchmark = loadRetrievalBenchmark();
  const ids = new Set(loadGuidelineCorpus().map((chunk) => chunk.source_id));
  assert.ok(benchmark.queries.length >= 18, 'about 20 labeled queries');
  const seen = new Set();
  for (const query of benchmark.queries) {
    assert.ok(!seen.has(query.id), `duplicate id ${query.id}`);
    seen.add(query.id);
    assert.ok(query.query.trim(), `${query.id} has a query`);
    assert.ok(query.relevant.length, `${query.id} has relevant chunks`);
    for (const id of query.relevant) assert.ok(ids.has(id), `${query.id} labels unknown chunk ${id}`);
    assert.ok(query.derived_from, `${query.id} says where it came from`);
  }
});

test('the benchmark labels file carries no raw patient identifiers from the golden truth files', () => {
  const raw = readFileSync(new URL('../test/fixtures/retrieval-benchmark.json', import.meta.url), 'utf8').toLowerCase();
  const truthDir = new URL('../test/fixtures/golden/truth/', import.meta.url);
  const identifiers = [];
  const collect = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, inner] of Object.entries(value)) {
      if (['name', 'patient_name', 'dob', 'phone'].includes(key) && typeof inner === 'string') identifiers.push(inner);
      else collect(inner);
    }
  };
  for (const name of ['intake-a.json', 'intake-b.json', 'lab-a.json', 'lab-b.json', 'gen-intake-c-conflict.json', 'gen-intake-d-dob.json']) collect(JSON.parse(readFileSync(new URL(name, truthDir), 'utf8')));
  assert.ok(identifiers.length >= 4, 'found the truth identifiers to check against');
  for (const identifier of identifiers) assert.ok(!raw.includes(identifier.toLowerCase()), 'a golden truth identifier leaked into the labels');
});
