import test from 'node:test';
import assert from 'node:assert/strict';
import { buildW2GoldenSet } from '../src/w2RegressionGate.js';
import { CANONICAL_CASE_BY_DOCUMENT, measureKeyMetrics, scoreDocumentCase } from '../scripts/measure-key-metrics.mjs';

const casesById = new Map(buildW2GoldenSet().map((testCase) => [testCase.id, testCase]));

test('scoreDocumentCase runs one golden case (lab-a) end to end and returns the expected shape', async () => {
  const testCase = casesById.get(CANONICAL_CASE_BY_DOCUMENT['lab-a']);
  assert.ok(testCase, 'the canonical lab-a case must exist in the current golden set');
  const scored = await scoreDocumentCase(testCase);

  assert.equal(scored.docId, 'lab-a');
  assert.equal(scored.hadAnswer, true);
  // lab-a's truth has exactly 2 lab results (Hemoglobin, A1C), both a clean
  // read -- both should match truth on all 5 keys.
  assert.equal(scored.labFields.length, 2);
  assert.ok(scored.labFields.every((field) => field.hit === true));
  // Only A1C is abnormal in lab-a's truth -- exactly one recall item, and it
  // must be a hit (it is a clean, high-confidence read that reaches the
  // deterministic answer as a patient_fact claim).
  const labRecallItems = scored.recallItems.filter((item) => item.field.startsWith('lab:'));
  assert.equal(labRecallItems.length, 1);
  assert.equal(labRecallItems[0].hit, true);
  // Every claim's citation should resolve offline for a clean vector-PDF read.
  assert.ok(scored.resolvability.length > 0);
  assert.ok(scored.resolvability.every((item) => item.resolved === true));
  for (const field of [...scored.labFields, ...scored.intakeFields]) {
    assert.ok('document' in field && 'field' in field && 'hit' in field);
  }
});

test('measureKeyMetrics on a single-document subset returns the full report shape with consistent totals', async () => {
  const report = await measureKeyMetrics({ caseIds: [CANONICAL_CASE_BY_DOCUMENT['lab-a']] });

  assert.equal(report.schema_version, 'agentforge-key-metrics-offline-v1');
  assert.equal(report.synthetic_only, true);
  assert.deepEqual(report.documents_scored, ['lab-a']);

  assert.equal(report.abnormal_finding_recall.answer_composer, 'deterministic');
  assert.equal(typeof report.abnormal_finding_recall.rate, 'number');
  assert.equal(report.abnormal_finding_recall.hits + report.abnormal_finding_recall.misses.length >= report.abnormal_finding_recall.total, true);

  assert.equal(report.extraction_accuracy.lab.total, 2);
  assert.equal(report.extraction_accuracy.combined.total, report.extraction_accuracy.lab.total + report.extraction_accuracy.intake.total);
  assert.deepEqual(report.extraction_accuracy.refusal_documents_counted_as_misses, []);
  assert.deepEqual(report.extraction_accuracy.documents_with_no_typed_truth_fields, []);

  assert.equal(typeof report.citation_resolvability_offline.rate, 'number');
  assert.deepEqual(report.citation_resolvability_offline.unresolved, []);
});

test('measureKeyMetrics rejects an unknown case id rather than silently skipping it', async () => {
  await assert.rejects(() => measureKeyMetrics({ caseIds: ['not-a-real-case'] }), /MEASURE_KEY_METRICS_UNKNOWN_CASE/);
});

test('every CANONICAL_CASE_BY_DOCUMENT id names a case that actually exists in the current golden set', () => {
  for (const [documentId, caseId] of Object.entries(CANONICAL_CASE_BY_DOCUMENT)) {
    assert.ok(casesById.has(caseId), `${documentId} -> ${caseId} must exist in buildW2GoldenSet()`);
    assert.equal(casesById.get(caseId).scenario.doc, documentId, `${caseId} must actually scan ${documentId}`);
  }
});
