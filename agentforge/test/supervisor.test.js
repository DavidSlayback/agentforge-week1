import test from 'node:test';
import assert from 'node:assert/strict';
import { executeSupervisorWorkflow, runDeterministicSupervisor, SUPERVISOR_STATES } from '../src/supervisor.js';

const evidence = (overrides = {}) => ({ status: 'ready', patient_facts: [{ source_type: 'patient_record', patient_ref: 'fixture-patient-001', source_id: 'problem-1', field: 'problem.diabetes.status', value: 'active' }], guideline_evidence: [{ title: 'Synthetic guideline', version: '2026.1', section: 'Review', snippet: 'Review documented evidence.', sparse_score: 1, dense_score: 1, rerank_score: 1, matched_terms: ['review'], citation: { source_type: 'guideline', source_id: 'guideline-1', page_or_section: 'Review', field_or_chunk_id: 'guideline-1', quote_or_value: 'Review documented evidence.' } }], retrieval: { guideline_status: 'complete', guideline_issues: [], failed_patient_groups: [] }, qualification: { required: false, reasons: [] }, ...overrides });

test('deterministic supervisor records typed worker handoffs and readiness', () => {
  const result = runDeterministicSupervisor({ intakeResult: { status: 'complete', facts: [{ field_id: 'lab.hgb.value' }] }, evidenceResult: evidence() });
  assert.equal(result.final_state, SUPERVISOR_STATES.READY);
  assert.equal(result.readiness, 'ready');
  assert.deepEqual(result.handoffs.map((handoff) => handoff.worker), ['intake-extractor', 'evidence-retriever', 'deterministic-verifier']);
  assert.equal(result.handoffs[0].input_type, 'source_documents');
  assert.ok(result.transitions.includes('VERIFY'));
});

test('deterministic supervisor qualifies incomplete evidence and blocks unsafe or uncited output', () => {
  assert.equal(runDeterministicSupervisor({ evidenceResult: evidence({ qualification: { required: true, reasons: ['insufficient_guideline_evidence'] } }) }).final_state, SUPERVISOR_STATES.QUALIFIED);
  assert.equal(runDeterministicSupervisor({ evidenceResult: evidence(), unsafe: true }).final_state, SUPERVISOR_STATES.BLOCKED);
  assert.equal(runDeterministicSupervisor({ evidenceResult: evidence({ guideline_evidence: [{ source_type: 'guideline', source_id: 'g' }] }) }).final_state, SUPERVISOR_STATES.BLOCKED);
  assert.equal(runDeterministicSupervisor({ evidenceResult: null }).final_state, SUPERVISOR_STATES.CLARIFY);
});

test('supervisor executes both workers and passes their typed outputs through verification', async () => {
  const calls = [];
  const result = await executeSupervisorWorkflow({
    request: { patient_uuid: 'fixture-patient-001', message: 'Review the synthetic document.' },
    sourceDocumentIds: ['synthetic-doc-1'],
    workers: {
      intakeExtractor: async ({ sourceDocumentIds }) => {
        calls.push('intake-extractor');
        assert.deepEqual(sourceDocumentIds, ['synthetic-doc-1']);
        return { status: 'complete', facts: [{ field: 'lab.hemoglobin', value: '13.2' }], documents: [{ source_document_id: 'synthetic-doc-1' }] };
      },
      evidenceRetriever: async () => {
        calls.push('evidence-retriever');
        return evidence();
      },
    },
  });
  assert.deepEqual(calls, ['intake-extractor', 'evidence-retriever']);
  assert.equal(result.final_state, SUPERVISOR_STATES.READY);
  assert.deepEqual(result.typed_outputs.intake.facts, [{ field: 'lab.hemoglobin', value: '13.2' }]);
  assert.deepEqual(result.handoffs.map((handoff) => handoff.worker), ['intake-extractor', 'evidence-retriever', 'deterministic-verifier']);
  assert.deepEqual(result.handoffs[0].document_types, []);
});

test('supervisor blocks when a requested worker fails', async () => {
  const result = await executeSupervisorWorkflow({
    request: {}, sourceDocumentIds: ['synthetic-doc-1'],
    workers: { intakeExtractor: async () => ({ status: 'blocked', facts: [] }), evidenceRetriever: async () => evidence() },
  });
  assert.equal(result.final_state, SUPERVISOR_STATES.BLOCKED);
});

// The HTTP-level "supervisor API returns an inspectable synthetic workflow"
// test that lived here was removed with the /v1/supervisor route (R2,
// issue #4); source-document.test.js now asserts that route answers 404.
// The remaining tests in this file exercise `executeSupervisorWorkflow`/
// `runDeterministicSupervisor` directly and are removed together with
// those functions later in R2.
