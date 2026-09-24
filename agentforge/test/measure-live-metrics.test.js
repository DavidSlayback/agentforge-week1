import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { computeLiveMetrics, selectSamples } from '../scripts/measure-live-metrics.mjs';

// Every assertion here runs against local files or synthetic in-memory
// records only -- this file makes no network call, and must never be given
// AGENTFORGE_LIVE_URL. `runLiveMetrics`/`main()` (the only network-touching
// code in the script) are deliberately not exercised by any test: the task
// requires this script be written, never run, against a live deployment.

test('selectSamples reads the real pdf-samples manifest and keeps only fixture-patient-001 documents', () => {
  const { toRun, skipped } = selectSamples({});
  assert.ok(toRun.length >= 4, 'expected at least the four known golden PDF samples');
  assert.ok(toRun.every((sample) => sample.filename && sample.document_type && sample.path));
  assert.deepEqual(skipped, [], 'none of the current pdf-samples belong to another patient fixture');
});

test('selectSamples skips (and explains) a sample belonging to a different patient fixture, from a synthetic manifest', () => {
  // Cannot write into the real fixtures directory (synthetic-data-only
  // repo); `readFileSync`/manifest shape is exercised instead by supplying a
  // fake dir via a temp manifest, mirroring the exact shape selectSamples
  // reads (`{ patient_fixture, samples: [{ filename, document_type, patient_fixture? }] }`).
  const dir = mkdtempSync(join(tmpdir(), 'measure-live-metrics-test-'));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    patient_fixture: 'fixture-patient-001',
    samples: [
      { filename: 'ok.pdf', document_type: 'lab_pdf' },
      { filename: 'mismatch.pdf', document_type: 'intake_form', patient_fixture: 'fixture-patient-002' },
    ],
  }));
  const { toRun, skipped } = selectSamples({ dir: `${dir}${sep}` });
  assert.deepEqual(toRun.map((sample) => sample.filename), ['ok.pdf']);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].filename, 'mismatch.pdf');
  assert.match(skipped[0].reason, /fixture-patient-002/);
  rmSync(dir, { recursive: true, force: true });
});

function record(overrides = {}) {
  return { ok: true, filename: 'x.pdf', final_state: 'READY', composer: 'model', model_rejected_reason: null, model_claims_proposed: 2, model_claims_verified: 2, had_answer: true, wall_time_ms: 100, stage_durations_ms: null, ...overrides };
}

test('computeLiveMetrics: model grounding rate sums verified/proposed across runs, not an average of per-run rates', () => {
  const records = [record({ model_claims_proposed: 4, model_claims_verified: 2 }), record({ model_claims_proposed: 1, model_claims_verified: 1 })];
  const result = computeLiveMetrics(records);
  assert.equal(result.model_grounding_rate.model_claims_proposed_total, 5);
  assert.equal(result.model_grounding_rate.model_claims_verified_total, 3);
  assert.equal(result.model_grounding_rate.rate, 0.6);
});

test('computeLiveMetrics: model grounding rate is null, not 0, when no model was ever called', () => {
  const records = [record({ composer: 'deterministic-fallback', model_rejected_reason: null, model_claims_proposed: 0, model_claims_verified: 0 })];
  const result = computeLiveMetrics(records);
  assert.equal(result.model_grounding_rate.rate, null);
});

test('computeLiveMetrics: composer fallback rate counts deterministic-fallback and any set model_rejected_reason, never a topped-up model answer', () => {
  const records = [
    record({ composer: 'model' }),
    record({ composer: 'model+deterministic-topup' }),
    record({ composer: 'deterministic-fallback', model_rejected_reason: 'provider_error', model_claims_proposed: 0, model_claims_verified: 0 }),
    // A hypothetical future composer value that still sets a rejection
    // reason must also count, independent of the composer string itself.
    record({ composer: 'model', model_rejected_reason: 'all_claims_unverified' }),
  ];
  const result = computeLiveMetrics(records);
  assert.equal(result.composer_fallback_rate.fallback_count, 2);
  assert.equal(result.composer_fallback_rate.answer_count, 4);
  assert.equal(result.composer_fallback_rate.rate, 0.5);
});

test('computeLiveMetrics: failed runs are excluded from rate/timing math but reported by count and stage', () => {
  const records = [record(), { ok: false, filename: 'bad.pdf', stage: 'upload', status: 500 }];
  const result = computeLiveMetrics(records);
  assert.equal(result.runs_attempted, 2);
  assert.equal(result.runs_succeeded, 1);
  assert.equal(result.runs_failed, 1);
  assert.deepEqual(result.failures, [{ filename: 'bad.pdf', stage: 'upload', status: 500 }]);
  assert.equal(result.wall_time_ms.samples, 1);
});

test('computeLiveMetrics: p50/p95 wall time and per-stage durations are computed from successful runs only', () => {
  const records = [10, 20, 30, 40, 100].map((ms) => record({ wall_time_ms: ms, stage_durations_ms: { answer: ms / 2 } }));
  const result = computeLiveMetrics(records);
  assert.equal(result.wall_time_ms.samples, 5);
  assert.equal(result.wall_time_ms.p50, 30);
  assert.equal(result.wall_time_ms.p95, 100);
  assert.equal(result.stage_durations_ms.by_stage.answer.samples, 5);
});

test('computeLiveMetrics never includes claim text, quotes, or values -- only counts, labels, and timings', () => {
  const result = computeLiveMetrics([record()]);
  const text = JSON.stringify(result);
  assert.ok(!/quote_or_value|citations|patient_facts|guideline_evidence/.test(text), 'the live metrics report must never carry raw claim/citation shapes, only aggregated counts');
});
