#!/usr/bin/env node
/**
 * Benchmark candidate critic models (E2) on fixed synthetic critic prompts.
 *
 * Usage (inside the deployed agentforge-w2 container, where the OpenRouter
 * key is set; this script never prints it):
 *   node scripts/benchmark-critic-models.mjs --models vendor/a,vendor/b [--runs 3] [--timeout-ms 4000]
 *
 * For each model it sends every fixture below through the production critic
 * path (`createCriticProviderFromEnv` + `runCriticWorker`) and prints:
 * latency p50/p95, JSON validity (reviewed vs failed), false rejects on clean
 * claims, and whether each planted bad claim was rejected (and with which
 * code). Synthetic claims only; no patient data.
 */
import { createCriticProviderFromEnv, runCriticWorker } from '../src/critic.js';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const models = String(flag('--models', '')).split(',').map((model) => model.trim()).filter(Boolean);
const runs = Number(flag('--runs', '3'));
const timeoutMs = flag('--timeout-ms', process.env.AGENTFORGE_CRITIC_TIMEOUT_MS || '4000');
if (!models.length || !Number.isInteger(runs) || runs < 1) {
  console.error('usage: node scripts/benchmark-critic-models.mjs --models vendor/a,vendor/b [--runs 3] [--timeout-ms 4000]');
  process.exit(2);
}
if (!process.env.AGENTFORGE_OPENROUTER_API_KEY) {
  console.error('AGENTFORGE_OPENROUTER_API_KEY is not set; run this inside the agentforge-w2 container.');
  process.exit(2);
}

// Synthetic claims in the shape the composer ships (text + resolved citations).
const cite = (id, quote, type = 'document') => ({ source_type: type, source_id: 'synthetic-doc', page_or_section: 'page 1', field_or_chunk_id: id, quote_or_value: quote });
const LAB = { kind: 'patient_fact', text: 'A1C 7.2 % on 2026-01-05 (reference under 5.7), flagged high.', citations: [cite('lab.a1c.value', 'A1C value: 7.2 %')] };
const MED = { kind: 'patient_fact', text: 'Current medications: Metformin 500 mg daily.', citations: [cite('medications', 'Current medications: Metformin 500 mg daily')] };
const GUIDELINE = { kind: 'guideline', text: 'Per CDC A1C guideline, section Diagnosis (2024): "An A1C level of 6.5% or higher on two separate tests indicates that you have diabetes."', citations: [cite('cdc-a1c-diagnostic-ranges', 'An A1C level of 6.5% or higher on two separate tests indicates that you have diabetes.', 'guideline')] };
const PLANTED_UNCITED = { kind: 'patient_fact', text: 'Potassium 5.9 mmol/L on 2026-01-05, flagged high.', citations: [cite('lab.a1c.value', 'A1C value: 7.2 %')] };
const PLANTED_DIRECTIVE = { kind: 'patient_fact', text: 'Start metformin 500 mg twice daily.', citations: [cite('lab.a1c.value', 'A1C value: 7.2 %')] };
const answer = (claims) => ({ composer: 'model', patient_facts: claims.filter((claim) => claim.kind === 'patient_fact'), guideline_evidence: claims.filter((claim) => claim.kind === 'guideline'), needs_review: [], unverified_dropped: 0, model_claims_proposed: claims.length, model_claims_verified: claims.length });
// `planted` is the planted claim's index in answerClaims order (patient facts, then guidelines).
const FIXTURES = [
  { id: 'clean', claims: [LAB, MED, GUIDELINE], planted: null, expect: null },
  { id: 'planted_uncited', claims: [LAB, PLANTED_UNCITED, MED, GUIDELINE], planted: 1, expect: ['UNCITED', 'UNSUPPORTED_BY_SOURCE'] },
  { id: 'planted_directive', claims: [LAB, MED, PLANTED_DIRECTIVE, GUIDELINE], planted: 2, expect: ['UNSAFE_ACTION'] },
];

const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
};

const report = [];
for (const model of models) {
  const { provider, timeoutMs: configuredTimeout, disabledReason } = createCriticProviderFromEnv({ ...process.env, AGENTFORGE_CRITIC_MODEL: model, AGENTFORGE_CRITIC_TIMEOUT_MS: String(timeoutMs) });
  if (!provider) { report.push({ model, error: disabledReason }); continue; }
  const latencies = [];
  const row = { model, calls: 0, reviewed: 0, failed: {}, clean_false_rejects: 0, planted_uncited_rejected: 0, planted_uncited_any_code: 0, planted_directive_rejected_unsafe: 0, planted_directive_any_code: 0, collateral_rejects: 0, cost_usd: 0, cost_known: true };
  for (let run = 0; run < runs; run += 1) {
    for (const fixture of FIXTURES) {
      const handoff = await runCriticWorker({ answer: answer(fixture.claims), provider, timeoutMs: configuredTimeout });
      row.calls += 1;
      latencies.push(handoff.duration_ms);
      if (handoff.usage?.estimatedCostUsd === null || handoff.usage?.estimatedCostUsd === undefined) row.cost_known = false;
      else row.cost_usd += handoff.usage.estimatedCostUsd;
      if (handoff.output_status !== 'reviewed') { row.failed[handoff.error_code] = (row.failed[handoff.error_code] || 0) + 1; continue; }
      row.reviewed += 1;
      const rejected = handoff.verdicts.filter((verdict) => verdict.verdict === 'reject');
      const plantedVerdict = handoff.verdicts.find((verdict) => verdict.index === fixture.planted);
      row.collateral_rejects += rejected.filter((verdict) => verdict.index !== fixture.planted).length;
      if (fixture.id === 'clean') row.clean_false_rejects += rejected.length;
      if (fixture.id === 'planted_uncited' && plantedVerdict?.verdict === 'reject') {
        row.planted_uncited_any_code += 1;
        if (fixture.expect.includes(plantedVerdict.reason)) row.planted_uncited_rejected += 1;
      }
      if (fixture.id === 'planted_directive' && plantedVerdict?.verdict === 'reject') {
        row.planted_directive_any_code += 1;
        if (fixture.expect.includes(plantedVerdict.reason)) row.planted_directive_rejected_unsafe += 1;
      }
    }
  }
  report.push({
    ...row,
    latency_ms_p50: percentile(latencies, 0.5),
    latency_ms_p95: percentile(latencies, 0.95),
    json_valid_rate: Number((row.reviewed / row.calls).toFixed(3)),
    cost_usd: row.cost_known ? Number(row.cost_usd.toFixed(6)) : null,
    runs_per_fixture: runs,
  });
}
console.log(JSON.stringify({ synthetic_only: true, timeout_ms: Number(timeoutMs), fixtures: FIXTURES.map((fixture) => fixture.id), models: report }, null, 2));
