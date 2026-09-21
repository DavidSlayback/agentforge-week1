import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryTraceSink } from '../../observability/index.js';
import { runSyntheticEvidenceEval, W2_EVAL_LABELS } from '../src/evaluation.js';

test('observability records W2 operational fields while redacting document content and prompts', () => {
  const sink = new InMemoryTraceSink();
  const trace = sink.start({ correlationId: 'af-eval-1', operation: 'evidence_workflow', scope: { patientRef: 'fixture-patient-001' } });
  trace.markAcknowledged();
  trace.recordHandoff({ worker: 'intake-extractor', input_type: 'intake_document', output_status: 'complete', value: 'raw patient value' });
  trace.setExtraction({ status: 'complete', confidence: 0.98, extracted_field: 'hemoglobin', quote: 'patient raw document content' });
  trace.setEvaluation({ status: 'recorded', caseType: 'extraction', outcome: 'pass', prompt: 'secret prompt' });
  trace.startStage('verification');
  trace.finishStage('verification', { status: 'success', field: 'patient diagnosis' });
  trace.complete({ status: 'success' });
  const stored = sink.list()[0];
  assert.equal(stored.extraction.status, 'complete');
  assert.equal(stored.extraction.confidence, 0.98);
  assert.equal(stored.extraction.extracted_field, '[REDACTED]');
  assert.equal(stored.evaluation.prompt, '[REDACTED]');
  assert.equal(stored.scope.patientRef, '[REDACTED]');
  assert.equal(stored.handoffs[0].value, '[REDACTED]');
});

test('synthetic W2 evaluation labels and results are reproducible', () => {
  const cases = [
    { id: 'extract-1', label: 'extraction', result: { qualification: { required: false } }, expected: {} },
    { id: 'retrieve-1', label: 'retrieval', result: { guideline_evidence: [{ source_id: 'g-1' }] }, expected: { must_have_guideline: true } },
    { id: 'refuse-1', label: 'refusal', result: { readiness: 'qualified' }, expected: { must_refuse: true } },
  ];
  const first = runSyntheticEvidenceEval(cases);
  const second = runSyntheticEvidenceEval(cases);
  assert.deepEqual(first, second);
  assert.deepEqual(first.labels, [...W2_EVAL_LABELS]);
  assert.equal(first.failed_cases, 0);
  assert.equal(first.synthetic_only, true);
});
