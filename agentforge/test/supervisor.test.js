import test from 'node:test';
import assert from 'node:assert/strict';
import { executeSupervisorWorkflow, runDeterministicSupervisor, SUPERVISOR_STATES } from '../src/supervisor.js';
import { startTestServer } from './helpers/testServer.js';

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

test('supervisor API returns an inspectable synthetic workflow', async () => {
  const port = 18808;
  const child = await startTestServer(port);
  try {
    const context = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=fixture-patient-001`).then((response) => response.json());
    const writeContext = await fetch(`http://127.0.0.1:${port}/v1/source-document-context?patient_uuid=fixture-patient-001`).then((response) => response.json());
    const source = await fetch(`http://127.0.0.1:${port}/v1/source-documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: writeContext.demo_token, document_type: 'lab_pdf', filename: 'synthetic-lab.txt', content_base64: Buffer.from('LAB|test=Hemoglobin|value=13.2|unit=g/dL|reference_range=12-16|collection_date=2026-09-20|abnormal=false|page=1|field_id=lab.hgb|quote=Hemoglobin 13.2 g/dL|bounding_box=10,20,100,40').toString('base64') }) }).then((response) => response.json());
    const response = await fetch(`http://127.0.0.1:${port}/v1/supervisor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', demo_token: context.demo_token, source_document_ids: [source.source_document.id], source_document_context_token: writeContext.demo_token, message: 'Review diabetes medication follow-up.' }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(['READY', 'QUALIFIED'].includes(body.final_state));
    assert.ok(body.handoffs.some((handoff) => handoff.worker === 'evidence-retriever'));
    assert.ok(body.handoffs.some((handoff) => handoff.worker === 'intake-extractor'));
    assert.deepEqual(body.handoffs.find((handoff) => handoff.worker === 'intake-extractor').document_types, ['lab_pdf']);
    assert.equal(body.handoffs.find((handoff) => handoff.worker === 'intake-extractor').input_type, 'source_documents');
    assert.equal(body.typed_outputs.intake.facts[0].value, '13.2');
  } finally {
    child.kill();
  }
});
