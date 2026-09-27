import test from 'node:test';
import assert from 'node:assert/strict';
import { RUNTIME_EVALUATION_KIND, computeRuntimeEvaluation } from '../src/runtimeEvaluation.js';

const readyAnswer = (overrides = {}) => ({
  composer: 'model+deterministic-topup',
  patient_facts: [{ kind: 'patient_fact' }],
  guideline_evidence: [{ kind: 'guideline' }],
  needs_review: [],
  unverified_dropped: 0,
  model_claims_proposed: 2,
  model_claims_verified: 2,
  ...overrides,
});

const readyWorkflow = (overrides = {}) => ({
  final_state: 'READY',
  readiness: 'ready',
  stop_reason: null,
  qualification: { required: false, reasons: [] },
  answer: readyAnswer(),
  ...overrides,
});

test('kind is always runtime_encounter, never the offline golden-set gate name', () => {
  const { evaluation } = computeRuntimeEvaluation({ workflow: readyWorkflow() });
  assert.equal(evaluation.kind, RUNTIME_EVALUATION_KIND);
  assert.equal(evaluation.kind, 'runtime_encounter');
});

test('blocked: a fail-loud safety refusal before any answer was composed', () => {
  const workflow = { final_state: 'BLOCKED', readiness: 'stopped', stop_reason: 'patient_mismatch', qualification: { required: true, reasons: ['patient_mismatch'] } };
  const { evaluation, verification } = computeRuntimeEvaluation({ workflow });
  assert.equal(evaluation.status, 'blocked');
  assert.equal(evaluation.final_state, 'BLOCKED');
  assert.equal(evaluation.stop_reason, 'patient_mismatch');
  assert.deepEqual(evaluation.qualification_reasons, ['patient_mismatch']);
  assert.equal(evaluation.read_back, null);
  // No answer exists to grade on a fail-loud stop.
  assert.equal(verification.status, 'not_applicable');
  assert.equal(verification.claims_proposed, 0);
});

test('blocked: readiness stopped is authoritative even if final_state is missing (e.g. document_unreadable)', () => {
  const workflow = { readiness: 'stopped', final_state: 'BLOCKED', stop_reason: 'document_unreadable', qualification: { required: true, reasons: ['document_unreadable'] } };
  const { evaluation } = computeRuntimeEvaluation({ workflow });
  assert.equal(evaluation.status, 'blocked');
  assert.equal(evaluation.stop_reason, 'document_unreadable');
});

test('passed: READY, nothing dropped or rejected, no read-back applicable', () => {
  const { evaluation, verification } = computeRuntimeEvaluation({ workflow: readyWorkflow() });
  assert.equal(evaluation.status, 'passed');
  assert.equal(evaluation.final_state, 'READY');
  assert.deepEqual(evaluation.issues, []);
  assert.equal(evaluation.read_back, null);
  assert.equal(verification.status, 'passed');
  assert.equal(verification.claims_dropped, 0);
  assert.equal(verification.record_claims_count, 1);
  assert.equal(verification.guideline_evidence_count, 1);
});

test('needs_review: QUALIFIED alone (no other issue) asks for review, never passed', () => {
  // Documented precisely: QUALIFIED is one of the degraded triggers by
  // itself (the safety/evidence check could not reach READY unassisted).
  const { evaluation } = computeRuntimeEvaluation({ workflow: readyWorkflow({ final_state: 'QUALIFIED', readiness: 'qualified', qualification: { required: true, reasons: ['doc_type_mismatch'] } }) });
  assert.equal(evaluation.status, 'needs_review');
  assert.ok(evaluation.issues.includes('qualified_not_ready'));
});

test('passed: an explicit read-back verification of true never blocks passed', () => {
  const { evaluation } = computeRuntimeEvaluation({ workflow: readyWorkflow(), readBack: { verified: true } });
  assert.equal(evaluation.status, 'passed');
  assert.deepEqual(evaluation.read_back, { verified: true });
});

test('degraded: the real model was rejected and the composer fell back', () => {
  const answer = readyAnswer({ composer: 'deterministic-fallback', model_rejected_reason: 'invalid_json' });
  const { evaluation, verification } = computeRuntimeEvaluation({ workflow: readyWorkflow({ answer }) });
  assert.equal(evaluation.status, 'degraded');
  assert.ok(evaluation.issues.includes('model_rejected:invalid_json'));
  assert.equal(verification.status, 'issues_found');
  assert.ok(verification.reason_codes.includes('model_rejected:invalid_json'));
});

test('passed: a dropped unverified claim is recorded as an issue but the verified answer still passes', () => {
  const answer = readyAnswer({ unverified_dropped: 2, model_claims_proposed: 4, model_claims_verified: 2 });
  const { evaluation, verification } = computeRuntimeEvaluation({ workflow: readyWorkflow({ answer }) });
  assert.equal(evaluation.status, 'passed');
  assert.ok(evaluation.issues.includes('claims_dropped'));
  assert.equal(verification.claims_dropped, 2);
  assert.equal(verification.status, 'issues_found');
});

test('needs_review: a low-confidence fact was excluded and flagged for review', () => {
  const answer = readyAnswer({ needs_review: [{ kind: 'lab_result', field: 'lab.hgb.value', reason: 'low_confidence' }] });
  const { evaluation, verification } = computeRuntimeEvaluation({ workflow: readyWorkflow({ answer }) });
  assert.equal(evaluation.status, 'needs_review');
  assert.ok(evaluation.issues.includes('needs_review'));
  assert.equal(verification.needs_review_count, 1);
  assert.ok(verification.reason_codes.includes('low_confidence'));
  // Never the field name or the extracted value -- counts and reason codes only.
  assert.ok(!JSON.stringify(verification).includes('lab.hgb.value'));
});

test('degraded: an OpenEMR read-back explicitly failed', () => {
  const { evaluation } = computeRuntimeEvaluation({ workflow: readyWorkflow(), readBack: { verified: false } });
  assert.equal(evaluation.status, 'degraded');
  assert.ok(evaluation.issues.includes('read_back_failed'));
  assert.deepEqual(evaluation.read_back, { verified: false });
});

test('degraded: no answer at all but the workflow was not marked stopped (defensive branch)', () => {
  const { evaluation, verification } = computeRuntimeEvaluation({ workflow: readyWorkflow({ answer: null }) });
  assert.equal(evaluation.status, 'degraded');
  assert.ok(evaluation.issues.includes('answer_missing'));
  assert.equal(verification.status, 'not_applicable');
});

test('verification never carries claim text, citation quotes, or extracted values', () => {
  const answer = readyAnswer({
    patient_facts: [{ kind: 'patient_fact', text: 'The chart records something.', citations: [{ quote_or_value: 'secret-value' }] }],
    guideline_evidence: [{ kind: 'guideline', text: 'Per guideline...' }],
  });
  const { verification } = computeRuntimeEvaluation({ workflow: readyWorkflow({ answer }) });
  const serialized = JSON.stringify(verification);
  assert.ok(!serialized.includes('secret-value'));
  assert.ok(!serialized.includes('The chart records'));
  // F-CLIN added safety-flag and not-documented counts (codes and counts only).
  assert.deepEqual(Object.keys(verification).sort(), ['claims_dropped', 'claims_proposed', 'claims_verified', 'composer', 'critic_flags_questioned', 'guideline_evidence_count', 'needs_review_count', 'not_documented_count', 'reason_codes', 'record_claims_count', 'safety_flag_codes', 'safety_flag_count', 'safety_flags_dropped', 'status'].sort());
});

test('production code never reads golden-set expectations: the function signature has no such input', () => {
  // computeRuntimeEvaluation only accepts {workflow, readBack} -- there is no
  // "expected"/golden parameter for it to read (AGENTS.md).
  const result = computeRuntimeEvaluation({ workflow: readyWorkflow(), expected: { should_be_ignored: true } });
  assert.ok(!JSON.stringify(result).includes('should_be_ignored'));
});
