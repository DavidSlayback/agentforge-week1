/**
 * Live measurement for the two KEY_METRICS.md rows that can only be measured
 * against a deployed instance: model grounding rate / composer fallback
 * rate, and time-to-grounded-answer.
 *
 * This script is written to be run by a reviewer AFTER a deploy, against
 * `AGENTFORGE_LIVE_URL` -- it is never invoked by the agent that wrote it, and
 * makes no network call at import time (only `runLiveMetrics()`/`main()`
 * touch the network; every pure aggregation function below is unit-testable
 * with synthetic records and no network access at all -- see
 * `test/measure-live-metrics.test.js`).
 *
 * Usage (reviewer, after a deploy):
 *   AGENTFORGE_LIVE_URL=https://dtstest.64.177.10.182.nip.io/agentforge-w2 \
 *   AGENTFORGE_LIVE_RUNS=3 \
 *   node scripts/measure-live-metrics.mjs
 *
 * What it does, and does not, measure:
 *   - Every golden PDF under `docs/agentforge/fixtures/scan-forms/
 *     pdf-samples/` whose manifest patient fixture is `fixture-patient-001`
 *     (currently all four -- lab-a, lab-b, intake-a, intake-b) is uploaded
 *     and scanned `AGENTFORGE_LIVE_RUNS` times each (default 3), sequentially,
 *     never in parallel, using the exact upload -> scan-supervisor flow the
 *     deployed demo UI itself uses (context token -> upload -> scan).
 *   - A golden PDF whose manifest names a different patient fixture (a
 *     patient-mismatch fixture, by construction refused rather than
 *     answered) is skipped, and listed under `skipped_documents` with why --
 *     none exist in this directory today, but the check is not hardcoded to
 *     today's four files.
 *   - Model grounding rate is `sum(model_claims_verified) /
 *     sum(model_claims_proposed)` over every answer that reached the answer
 *     stage at all (Task 1, `GroundedAnswerResult`) -- `null` (not `0` or
 *     `NaN`) when the sum of proposed is 0, e.g. no live answer model is
 *     configured at all on this deployment, so "0% grounded" is never
 *     confused with "no model was ever called."
 *   - Composer fallback rate: the share of answers whose `composer` is
 *     `deterministic-fallback`, OR whose `model_rejected_reason` is set.
 *     Today those two conditions always co-occur (`answerComposer.js` only
 *     ever sets `model_rejected_reason` alongside `composer:
 *     'deterministic-fallback'`), but both are checked independently so this
 *     stays correct if that ever changes. `model+deterministic-topup`
 *     (the model produced *some* real, verified output) never counts as a
 *     fallback.
 *   - Per-stage timings: the deployed `/v1/scan-supervisor` response carries
 *     no correlation id to key a lookup by, and a real trace's `scope`
 *     (which is where `patientRef` lives) is PHI-redacted to `[REDACTED]`
 *     before `GET /v1/traces` ever returns it -- so neither a response-body
 *     join nor a patient-matching join is possible. Traces also key their
 *     start time as `startedAt` (an ISO string), not `start`. This script
 *     instead does an exact-by-elimination join: it snapshots the set of
 *     `w2-scan-supervisor` trace `correlationId`s that exist right before
 *     issuing the call, then -- since every call in the sweep is sequential,
 *     never parallel -- the one `w2-scan-supervisor` trace that appears
 *     afterwards with a `correlationId` absent from that snapshot is this
 *     call's trace (see `matchNewTrace`, unit-tested against a hand-built
 *     fixture shaped like a real trace). This is still best-effort on a
 *     server also serving other concurrent scan-supervisor traffic (a
 *     concurrent call could produce the "new" trace this run attributes to
 *     itself), which is why `stage_durations_ms` keeps its best-effort label
 *     -- but it no longer depends on a redacted field or a wrong key name,
 *     so on an otherwise-idle deployment (the intended way to run this
 *     script) it is exact.
 *   - Re-uploading byte-identical PDF content hits the server's OCR/extraction
 *     cache, so a repeat run's `source_preparation` stage collapses to near
 *     0 ms instead of doing real OCR work. Mixing those "warm" runs into the
 *     same p50/p95 as genuine "cold" (first-seen-bytes) runs would understate
 *     real latency, so every successful run is classified `cold` or `warm`
 *     from its own measured `source_preparation` duration (`> 1000ms` is
 *     cold; see `classifyCacheState`), and every reported per-stage
 *     percentile is split by that classification.
 *   - Token usage and cost: each matched trace's `modelTotals` (summed
 *     per-call `estimatedCostUsd`/token counts, already computed server-side
 *     in `observability/index.js#TraceRecorder`) is reported per run and
 *     summed across runs. If any matched trace has `modelTotals.cost_complete
 *     === false` (at least one call in it had an unknown per-call cost), the
 *     total is reported as `null` -- with a count of how many traces were
 *     incomplete -- rather than silently summing a partial total as if it
 *     were the whole spend.
 *   - Never prints claim text, citation quotes, or extracted values -- only
 *     counts, composer/reason labels, and timings, per AGENTS.md (PHI: never
 *     log raw extracted values) and the task's own instruction.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PDF_SAMPLES_DIR = fileURLToPath(new URL('../../docs/agentforge/fixtures/scan-forms/pdf-samples/', import.meta.url));
const PATIENT = 'fixture-patient-001';
const CLINICIAN = 'fixture-physician-001';
const MESSAGE = 'What changed and what should I pay attention to?';
const SCAN_SUPERVISOR_OPERATION = 'w2-scan-supervisor';
// A repeat upload of byte-identical content hits the OCR/extraction cache and
// finishes `source_preparation` in low single-digit ms; a real (cold) OCR
// pass takes far longer. 1000ms comfortably separates the two on this
// workload -- see the module doc for why the distinction matters.
const COLD_SOURCE_PREPARATION_THRESHOLD_MS = 1000;

/** Read the pdf-samples manifest and return `{ toRun, skipped }`, where
 * `toRun` is every sample belonging to `PATIENT` (ready to upload) and
 * `skipped` names every sample that belongs to a different patient fixture,
 * with why. Never assumes "4 files" -- reads whatever the manifest lists. */
export function selectSamples({ dir = PDF_SAMPLES_DIR, patient = PATIENT } = {}) {
  const manifest = JSON.parse(readFileSync(`${dir}manifest.json`, 'utf8'));
  const toRun = [];
  const skipped = [];
  for (const sample of manifest.samples || []) {
    const samplePatient = sample.patient_fixture || manifest.patient_fixture;
    if (samplePatient !== patient) { skipped.push({ filename: sample.filename, reason: `belongs to ${samplePatient || 'an unknown patient fixture'}, not ${patient} -- would be refused as a patient mismatch, not answered` }); continue; }
    toRun.push({ filename: sample.filename, document_type: sample.document_type, path: `${dir}${sample.filename}` });
  }
  return { toRun, skipped };
}

/**
 * Pick the trace this run produced out of a full `GET /v1/traces` listing
 * (`tracesAfter`), given the set of matching-operation `correlationId`s that
 * already existed *before* the call was made (`beforeCorrelationIds`). This
 * is the exact-by-elimination join described in the module doc: since the
 * caller never issues two scan-supervisor calls concurrently, the trace(s)
 * with a `correlationId` absent from the "before" snapshot are new, and the
 * earliest-started one is this call's. Returns `null` when nothing new
 * matched (e.g. the trace store already evicted it, or `/v1/traces` failed).
 * Pure and network-free -- exported for unit testing against a hand-built
 * fixture shaped like a real trace, with no need to hit a live server.
 */
export function matchNewTrace(tracesAfter, beforeCorrelationIds, { operation }) {
  const candidates = (tracesAfter || [])
    .filter((trace) => trace.operation === operation && !beforeCorrelationIds.has(trace.correlationId))
    .sort((a, b) => new Date(a.startedAt || 0).getTime() - new Date(b.startedAt || 0).getTime());
  return candidates[0] || null;
}

/** `cold` (real OCR work), `warm` (OCR/extraction cache hit on re-uploaded
 * identical bytes), or `unknown` (no `source_preparation` duration was
 * available at all, e.g. the trace never matched). Pure and unit-testable. */
export function classifyCacheState(stageDurationsMs, { coldThresholdMs = COLD_SOURCE_PREPARATION_THRESHOLD_MS } = {}) {
  const sourcePreparationMs = stageDurationsMs?.source_preparation;
  if (typeof sourcePreparationMs !== 'number') return 'unknown';
  return sourcePreparationMs > coldThresholdMs ? 'cold' : 'warm';
}

async function jsonFetch(base, path, options) {
  const response = await fetch(`${base}${path}`, options);
  let data = null;
  try { data = await response.json(); } catch { /* non-JSON or empty body */ }
  return { status: response.status, data };
}

/** Upload one document and run scan-supervisor once, exactly the reference
 * flow the task gave (context token, upload, scan-supervisor), timing only
 * the scan-supervisor call as "time to grounded answer" (upload time is
 * reported separately, never folded in -- a slow upload is a different
 * problem than a slow answer). Returns one raw run record; never throws for
 * an HTTP-level failure (recorded as `ok: false` with the status/error
 * instead), so one bad run never aborts the whole sweep. */
async function runOnce(baseUrl, sample, { fetchImpl = jsonFetch } = {}) {
  // The mint needs the evaluator access key (W3, F-24b44c5180).
  const key = process.env.AGENTFORGE_DEMO_ACCESS_KEY;
  const contextResponse = await fetchImpl(baseUrl, `/v1/source-document-context?patient_uuid=${PATIENT}`, key ? { headers: { 'x-agentforge-demo-key': key } } : undefined);
  const demoToken = contextResponse.data?.demo_token;
  if (!demoToken) return { ok: false, filename: sample.filename, stage: 'context', status: contextResponse.status };

  const contentBase64 = readFileSync(sample.path).toString('base64');
  const uploadResponse = await fetchImpl(baseUrl, '/v1/source-documents', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patient_uuid: PATIENT, clinician_uuid: CLINICIAN, demo_token: demoToken, document_type: sample.document_type, filename: sample.filename, content_base64: contentBase64 }),
  });
  const sourceDocumentId = uploadResponse.data?.source_document?.id;
  if (!sourceDocumentId) return { ok: false, filename: sample.filename, stage: 'upload', status: uploadResponse.status };

  // Snapshot every existing w2-scan-supervisor correlationId immediately
  // before issuing the call -- see `matchNewTrace` / the module doc for why
  // this replaces the old (always-failing) patient+time-window match. A
  // failed snapshot fetch degrades to an empty set, which still lets
  // `matchNewTrace` run (worst case it now risks matching a pre-existing
  // trace instead of finding none at all, an acceptable best-effort trade
  // since stage timings are always labeled best-effort).
  let beforeCorrelationIds = new Set();
  try {
    const before = await fetchImpl(baseUrl, '/v1/traces');
    beforeCorrelationIds = new Set((before.data || []).filter((trace) => trace.operation === SCAN_SUPERVISOR_OPERATION).map((trace) => trace.correlationId));
  } catch { /* best-effort only -- see above */ }

  const startedAt = Date.now();
  const scanResponse = await fetchImpl(baseUrl, '/v1/scan-supervisor', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ patient_uuid: PATIENT, clinician_uuid: CLINICIAN, demo_token: demoToken, source_document_id: sourceDocumentId, message: MESSAGE }),
  });
  const wallTimeMs = Date.now() - startedAt;
  if (scanResponse.status !== 200) return { ok: false, filename: sample.filename, stage: 'scan-supervisor', status: scanResponse.status };

  const workflow = scanResponse.data?.workflow || {};
  const answer = workflow.answer || null;
  let stageDurationsMs = null;
  let modelTotals = null;
  try {
    const traces = await fetchImpl(baseUrl, '/v1/traces');
    const candidate = matchNewTrace(traces.data, beforeCorrelationIds, { operation: SCAN_SUPERVISOR_OPERATION });
    if (candidate?.stages?.length) stageDurationsMs = Object.fromEntries(candidate.stages.map((stage) => [stage.name, stage.durationMs]));
    if (candidate?.modelTotals) modelTotals = candidate.modelTotals;
  } catch { /* best-effort only -- total wall time above is always trustworthy regardless */ }

  return {
    ok: true,
    filename: sample.filename,
    final_state: workflow.final_state || null,
    composer: answer?.composer ?? null,
    model_rejected_reason: answer?.model_rejected_reason ?? null,
    model_claims_proposed: answer ? (answer.model_claims_proposed ?? 0) : null,
    model_claims_verified: answer ? (answer.model_claims_verified ?? 0) : null,
    had_answer: Boolean(answer),
    wall_time_ms: wallTimeMs,
    stage_durations_ms: stageDurationsMs,
    cache_state: classifyCacheState(stageDurationsMs),
    model_totals: modelTotals,
  };
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return null;
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, index)];
}

/**
 * Pure aggregation over already-collected run records (no network) --
 * exported so it is unit-testable with synthetic records. `records` is the
 * list `runLiveMetrics` builds from `runOnce`, plus any `{ ok: false, ... }`
 * failures.
 */
export function computeLiveMetrics(records) {
  const successful = records.filter((record) => record.ok);
  const failed = records.filter((record) => !record.ok);
  const withAnswer = successful.filter((record) => record.had_answer);

  const proposedTotal = withAnswer.reduce((sum, record) => sum + (record.model_claims_proposed || 0), 0);
  const verifiedTotal = withAnswer.reduce((sum, record) => sum + (record.model_claims_verified || 0), 0);

  const isFallback = (record) => record.composer === 'deterministic-fallback' || Boolean(record.model_rejected_reason);
  const fallbackCount = withAnswer.filter(isFallback).length;

  const composerCounts = {};
  for (const record of withAnswer) { const key = record.composer ?? 'no_answer'; composerCounts[key] = (composerCounts[key] || 0) + 1; }
  const rejectedReasonCounts = {};
  for (const record of withAnswer) { const key = record.model_rejected_reason ?? 'none'; rejectedReasonCounts[key] = (rejectedReasonCounts[key] || 0) + 1; }
  const finalStateCounts = {};
  for (const record of successful) { const key = record.final_state ?? 'unknown'; finalStateCounts[key] = (finalStateCounts[key] || 0) + 1; }

  const wallTimes = successful.map((record) => record.wall_time_ms).sort((a, b) => a - b);
  const perStageFor = (records) => {
    const stageNames = [...new Set(records.flatMap((record) => Object.keys(record.stage_durations_ms || {})))];
    return Object.fromEntries(stageNames.map((name) => {
      const values = records.map((record) => record.stage_durations_ms?.[name]).filter((value) => typeof value === 'number').sort((a, b) => a - b);
      return [name, { p50_ms: percentile(values, 50), p95_ms: percentile(values, 95), samples: values.length }];
    }));
  };
  const perStage = perStageFor(successful);
  const coldRuns = successful.filter((record) => record.cache_state === 'cold');
  const warmRuns = successful.filter((record) => record.cache_state === 'warm');
  const unknownCacheStateRuns = successful.filter((record) => !record.cache_state || record.cache_state === 'unknown');

  const withMatchedTrace = successful.filter((record) => record.model_totals);
  const incompleteCostTraces = withMatchedTrace.filter((record) => record.model_totals.cost_complete === false);
  const totalInputTokens = withMatchedTrace.reduce((sum, record) => sum + (record.model_totals.input_tokens || 0), 0);
  const totalOutputTokens = withMatchedTrace.reduce((sum, record) => sum + (record.model_totals.output_tokens || 0), 0);
  const totalCalls = withMatchedTrace.reduce((sum, record) => sum + (record.model_totals.calls || 0), 0);
  const totalCostUsd = incompleteCostTraces.length > 0
    ? null
    : Number(withMatchedTrace.reduce((sum, record) => sum + (record.model_totals.cost_usd || 0), 0).toFixed(8));

  return {
    runs_attempted: records.length,
    runs_succeeded: successful.length,
    runs_failed: failed.length,
    failures: failed.map(({ filename, stage, status }) => ({ filename, stage, status })),
    model_grounding_rate: {
      definition: 'sum(model_claims_verified) / sum(model_claims_proposed) over every answer that reached the answer stage; null (never 0) when no model was ever called (sum proposed is 0), so "no model configured" is never confused with "0% grounded."',
      model_claims_proposed_total: proposedTotal,
      model_claims_verified_total: verifiedTotal,
      rate: proposedTotal > 0 ? Number((verifiedTotal / proposedTotal).toFixed(4)) : null,
    },
    composer_fallback_rate: {
      definition: 'share of answers whose composer is deterministic-fallback, OR whose model_rejected_reason is set (checked independently; today the two always co-occur). model+deterministic-topup is never counted as a fallback.',
      fallback_count: fallbackCount,
      answer_count: withAnswer.length,
      rate: withAnswer.length ? Number((fallbackCount / withAnswer.length).toFixed(4)) : null,
    },
    composer_counts: composerCounts,
    rejected_reason_counts: rejectedReasonCounts,
    final_state_counts: finalStateCounts,
    wall_time_ms: { p50: percentile(wallTimes, 50), p95: percentile(wallTimes, 95), samples: wallTimes.length },
    stage_durations_ms: {
      note: 'best-effort, matched from GET /v1/traces by an exact correlationId-elimination join (new w2-scan-supervisor trace not present before the call) -- see module doc for the matching caveat on a server also serving other concurrent scan-supervisor traffic',
      by_stage: perStage,
      cold: { definition: 'source_preparation > 1000ms -- a real OCR pass, not an OCR/extraction cache hit', samples: coldRuns.length, by_stage: perStageFor(coldRuns) },
      warm: { definition: 'source_preparation <= 1000ms -- re-uploaded byte-identical content served from the OCR/extraction cache', samples: warmRuns.length, by_stage: perStageFor(warmRuns) },
      unknown_cache_state: unknownCacheStateRuns.length,
    },
    token_usage_and_cost: {
      definition: 'per-run and total token usage/cost from each run\'s matched trace modelTotals (server-computed real per-call cost); total_cost_usd is null (never a silent partial sum) when any matched trace has modelTotals.cost_complete: false',
      runs_with_matched_trace: withMatchedTrace.length,
      runs_missing_trace_match: successful.length - withMatchedTrace.length,
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
      total_calls: totalCalls,
      total_cost_usd: totalCostUsd,
      incomplete_cost_trace_count: incompleteCostTraces.length,
      per_run: withMatchedTrace.map((record) => ({
        filename: record.filename,
        cache_state: record.cache_state,
        input_tokens: record.model_totals.input_tokens || 0,
        output_tokens: record.model_totals.output_tokens || 0,
        calls: record.model_totals.calls || 0,
        cost_usd: record.model_totals.cost_complete === false ? null : (record.model_totals.cost_usd ?? null),
        cost_complete: record.model_totals.cost_complete !== false,
      })),
    },
  };
}

/** The actual network-touching sweep: uploads and scans every selected
 * sample `runs` times, sequentially. Never called except from `main()` below
 * (i.e. only when this file is executed directly with `AGENTFORGE_LIVE_URL`
 * set), and never by any test. */
export async function runLiveMetrics({ baseUrl, runs = 3, samplesDir = PDF_SAMPLES_DIR } = {}) {
  const { toRun, skipped } = selectSamples({ dir: samplesDir });
  const records = [];
  for (let run = 1; run <= runs; run += 1) {
    for (const sample of toRun) {
      // Sequential by construction (awaited in-loop, no Promise.all): the
      // task requires this, and it also avoids the shared-trace-matching
      // ambiguity `runOnce`'s best-effort /v1/traces lookup would otherwise
      // face against genuinely concurrent requests.
      records.push(await runOnce(baseUrl, sample));
    }
  }
  return { skipped_documents: skipped, documents: toRun.map((sample) => sample.filename), runs_per_document: runs, ...computeLiveMetrics(records) };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const baseUrl = process.env.AGENTFORGE_LIVE_URL;
  if (!baseUrl) {
    console.error('AGENTFORGE_LIVE_URL is required, e.g.:');
    console.error('  AGENTFORGE_LIVE_URL=https://dtstest.64.177.10.182.nip.io/agentforge-w2 node scripts/measure-live-metrics.mjs');
    process.exitCode = 1;
  } else {
    const runs = Number(process.env.AGENTFORGE_LIVE_RUNS || 3);
    const report = await runLiveMetrics({ baseUrl: baseUrl.replace(/\/$/, ''), runs });
    console.log(JSON.stringify({ schema_version: 'agentforge-key-metrics-live-v1', synthetic_only: true, base_url: baseUrl, ...report }, null, 2));
  }
}
