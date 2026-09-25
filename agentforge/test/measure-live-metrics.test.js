import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { computeLiveMetrics, selectSamples, matchNewTrace, classifyCacheState } from '../scripts/measure-live-metrics.mjs';

// A fixture shaped like a real (redacted) w2-scan-supervisor trace as
// returned by `GET /v1/traces` -- hand-built from the real shape documented
// in observability/index.js#TraceRecorder.complete and
// service.js#runActiveSupervisorForDocument, not from any real deployment
// response. Two real-world facts this fixture must preserve, because the
// original matching bug depended on getting them wrong:
//   1. the trace's start time lives at the top level as `startedAt` (an ISO
//      string) -- there is no `start` field on the trace itself (only inside
//      each stage, which the old code never read either).
//   2. `scope.patientRef` is redacted to the literal string '[REDACTED]' by
//      `observability/index.js#redactPayload` before this endpoint ever
//      returns it, because the key name "patientRef" matches the PHI
//      redaction pattern -- so a live trace's real patient id is never
//      visible here, no matter which patient the scan was for.
function fakeTrace(overrides = {}) {
  return {
    schemaVersion: 2,
    correlationId: 'w2-scan-fake-0001',
    operation: 'w2-scan-supervisor',
    interactionType: 'scan_form',
    startedAt: '2026-09-24T14:00:00.000Z',
    completedAt: '2026-09-24T14:00:01.000Z',
    durationMs: 1000,
    status: 'success',
    scope: { patientRef: '[REDACTED]' },
    stages: [
      { name: 'source_preparation', sequence: 1, durationMs: 900, status: 'complete' },
      { name: 'extraction', sequence: 2, durationMs: 50, status: 'complete' },
      { name: 'retrieval', sequence: 3, durationMs: 30, status: 'complete' },
      { name: 'answer', sequence: 4, durationMs: 20, status: 'model' },
    ],
    modelUsage: [{ stage: 'answer', provider: 'synthetic-provider', model: 'synthetic-preview-model', inputTokens: 100, outputTokens: 40, estimatedCostUsd: 0.0005 }],
    modelTotals: { input_tokens: 100, output_tokens: 40, cost_usd: 0.0005, calls: 1, cost_complete: true },
    ...overrides,
  };
}

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

// --- matchNewTrace: the exact-join fix for the root-cause matching bug -----
//
// The old code filtered `/v1/traces` on `trace.scope?.patientRef === PATIENT`
// and `new Date(trace.start || 0).getTime() >= startedAt - 1000`. Against a
// real trace (`fakeTrace()` above) both conditions are always false:
// `scope.patientRef` is the literal string '[REDACTED]' (never equal to any
// real patient id), and `trace.start` does not exist on a trace at all (only
// `startedAt` does, so `trace.start || 0` was always `0` -- epoch, always
// older than "now minus a second"). The result was `stage_durations_ms:
// by_stage: {}` on every real run. `matchNewTrace` replaces both broken
// conditions with an operation match plus a before/after correlationId diff.

test('matchNewTrace finds the one new trace whose correlationId was not in the before-snapshot', () => {
  const before = new Set(['w2-scan-fake-0001']);
  const tracesAfter = [fakeTrace({ correlationId: 'w2-scan-fake-0001' }), fakeTrace({ correlationId: 'w2-scan-fake-0002', startedAt: '2026-09-24T14:05:00.000Z' })];
  const match = matchNewTrace(tracesAfter, before, { operation: 'w2-scan-supervisor' });
  assert.equal(match.correlationId, 'w2-scan-fake-0002');
});

test('matchNewTrace works against a real (redacted) trace shape even though scope.patientRef is always [REDACTED] and there is no top-level `start` field', () => {
  // This is exactly the case that defeated the old patient+time-window
  // filter: nothing about this trace's PHI-safe fields distinguishes it by
  // patient or by a `start` key that does not exist -- only the
  // correlationId diff does.
  const trace = fakeTrace({ correlationId: 'w2-scan-fake-real-shape' });
  assert.equal(trace.scope.patientRef, '[REDACTED]');
  assert.equal(trace.start, undefined);
  const match = matchNewTrace([trace], new Set(), { operation: 'w2-scan-supervisor' });
  assert.equal(match.correlationId, 'w2-scan-fake-real-shape');
});

test('matchNewTrace ignores traces for a different operation', () => {
  const tracesAfter = [fakeTrace({ correlationId: 'other-op', operation: 'w2-briefing' })];
  const match = matchNewTrace(tracesAfter, new Set(), { operation: 'w2-scan-supervisor' });
  assert.equal(match, null);
});

test('matchNewTrace returns null when nothing new appeared', () => {
  const tracesAfter = [fakeTrace({ correlationId: 'w2-scan-fake-0001' })];
  const match = matchNewTrace(tracesAfter, new Set(['w2-scan-fake-0001']), { operation: 'w2-scan-supervisor' });
  assert.equal(match, null);
});

test('matchNewTrace picks the earliest-started new trace when more than one is new', () => {
  const tracesAfter = [
    fakeTrace({ correlationId: 'later', startedAt: '2026-09-24T14:10:00.000Z' }),
    fakeTrace({ correlationId: 'earlier', startedAt: '2026-09-24T14:00:00.000Z' }),
  ];
  const match = matchNewTrace(tracesAfter, new Set(), { operation: 'w2-scan-supervisor' });
  assert.equal(match.correlationId, 'earlier');
});

// --- classifyCacheState: cold (real OCR) vs warm (OCR cache hit) -----------

test('classifyCacheState: source_preparation over the threshold is cold', () => {
  assert.equal(classifyCacheState({ source_preparation: 1500 }), 'cold');
});

test('classifyCacheState: source_preparation at or under the threshold is warm', () => {
  assert.equal(classifyCacheState({ source_preparation: 5 }), 'warm');
  assert.equal(classifyCacheState({ source_preparation: 1000 }), 'warm');
});

test('classifyCacheState: unknown when there is no source_preparation duration at all (e.g. the trace never matched)', () => {
  assert.equal(classifyCacheState(null), 'unknown');
  assert.equal(classifyCacheState({}), 'unknown');
});

// --- computeLiveMetrics: cold vs warm stage stats, and token/cost totals ---

test('computeLiveMetrics splits per-stage p50/p95 into cold and warm buckets using each run\'s cache_state', () => {
  const cold = [1200, 1300, 1400].map((ms) => record({ cache_state: 'cold', stage_durations_ms: { source_preparation: ms, extraction: 50 } }));
  const warm = [5, 10].map((ms) => record({ cache_state: 'warm', stage_durations_ms: { source_preparation: ms, extraction: 5 } }));
  const result = computeLiveMetrics([...cold, ...warm]);
  assert.equal(result.stage_durations_ms.cold.samples, 3);
  assert.equal(result.stage_durations_ms.warm.samples, 2);
  assert.equal(result.stage_durations_ms.cold.by_stage.source_preparation.samples, 3);
  assert.equal(result.stage_durations_ms.warm.by_stage.source_preparation.samples, 2);
  assert.equal(result.stage_durations_ms.cold.by_stage.source_preparation.p50_ms, 1300);
  assert.equal(result.stage_durations_ms.warm.by_stage.source_preparation.p50_ms, 5);
  // Still available unsplit, for the existing overall view.
  assert.equal(result.stage_durations_ms.by_stage.source_preparation.samples, 5);
});

test('computeLiveMetrics: token usage and cost sum modelTotals across runs, matching modelTotals.cost_usd exactly (not re-derived)', () => {
  const records = [
    record({ model_totals: { input_tokens: 100, output_tokens: 40, cost_usd: 0.0005, calls: 1, cost_complete: true } }),
    record({ model_totals: { input_tokens: 200, output_tokens: 80, cost_usd: 0.001, calls: 1, cost_complete: true } }),
  ];
  const result = computeLiveMetrics(records);
  assert.equal(result.token_usage_and_cost.runs_with_matched_trace, 2);
  assert.equal(result.token_usage_and_cost.runs_missing_trace_match, 0);
  assert.equal(result.token_usage_and_cost.total_input_tokens, 300);
  assert.equal(result.token_usage_and_cost.total_output_tokens, 120);
  assert.equal(result.token_usage_and_cost.total_cost_usd, 0.0015);
  assert.equal(result.token_usage_and_cost.incomplete_cost_trace_count, 0);
});

test('computeLiveMetrics: total cost is null (never a silent partial sum), with a count, when any matched trace has an incomplete cost', () => {
  const records = [
    record({ model_totals: { input_tokens: 100, output_tokens: 40, cost_usd: 0.0005, calls: 1, cost_complete: true } }),
    record({ model_totals: { input_tokens: 200, output_tokens: 80, cost_usd: null, calls: 1, cost_complete: false } }),
  ];
  const result = computeLiveMetrics(records);
  assert.equal(result.token_usage_and_cost.total_cost_usd, null);
  assert.equal(result.token_usage_and_cost.incomplete_cost_trace_count, 1);
  // Token counts are still known even when cost is not -- summed regardless.
  assert.equal(result.token_usage_and_cost.total_input_tokens, 300);
  const incompleteRun = result.token_usage_and_cost.per_run.find((run) => run.cost_complete === false);
  assert.equal(incompleteRun.cost_usd, null);
});

test('computeLiveMetrics: a run whose trace never matched (model_totals null) is counted as missing, not zero', () => {
  const records = [record({ model_totals: null }), record({ model_totals: { input_tokens: 10, output_tokens: 5, cost_usd: 0.0001, calls: 1, cost_complete: true } })];
  const result = computeLiveMetrics(records);
  assert.equal(result.token_usage_and_cost.runs_with_matched_trace, 1);
  assert.equal(result.token_usage_and_cost.runs_missing_trace_match, 1);
});
