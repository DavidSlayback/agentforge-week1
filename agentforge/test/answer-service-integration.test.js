import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';
import { DeterministicAnswerComposer } from '../src/answerComposer.js';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { DeterministicProvider, ResilientProvider } from '../src/modelProvider.js';
import { AgentForgeService } from '../src/service.js';
import { SyntheticWriteback } from '../src/syntheticWriteback.js';
import { startTestServer } from './helpers/testServer.js';

const fixturePath = fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url));
const SECRET = 'answer-service-integration-secret';
const context = (patient, scope = 'read-briefing') => verifySignedContext(issueSignedContext({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', scope, acl: scope === 'read-briefing' ? 'read' : 'write', secret: SECRET }), SECRET);
const labA = () => fs.readFileSync(fileURLToPath(new URL('../../docs/agentforge/fixtures/scan-forms/lab-layout-a-complete.scan.txt', import.meta.url)));

function serviceWith(overrides = {}) {
  const writeback = new SyntheticWriteback();
  const service = new AgentForgeService({ chartAdapter: new FixtureAdapter(fixturePath), writeback, provider: new DeterministicProvider(), ...overrides });
  const run = async ({ uploadPatient = 'fixture-patient-001', requestPatient = uploadPatient, query = 'documented glycemic values medication adherence' } = {}) => {
    const upload = await service.ingestSourceDocument({ patient_uuid: uploadPatient, clinician_uuid: 'fixture-physician-001', document_type: 'lab_pdf', filename: 'lab-a.pdf', content: labA() }, { verifiedContext: context(uploadPatient, 'write-source-document') });
    return service.runActiveSupervisorForDocument(upload.source_document.id, { patient_uuid: requestPatient, clinician_uuid: 'fixture-physician-001' }, { verifiedContext: context(requestPatient), query });
  };
  return { service, run };
}

// F6: the per-request deadline forces a deterministic answer once it fires.
test('a scan deadline of 0ms composes the answer deterministically with model_rejected_reason: deadline', async () => {
  const slowPrimary = { name: 'slow-model', model: 'slow-v1', async checkReady() { return true; }, async generate({ signal }) { await new Promise((resolve) => setTimeout(resolve, 20)); if (signal?.aborted) throw new Error('MODEL_ABORTED'); return { text: '{"claims":[]}', inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 }; } };
  const answerProvider = new ResilientProvider({ primary: slowPrimary, fallback: new DeterministicAnswerComposer() });
  const { run } = serviceWith({ answerProvider, scanDeadlineMs: 0 });
  const result = await run();
  assert.equal(result.status, 'completed');
  assert.ok(result.workflow.answer);
  assert.equal(result.workflow.answer.composer, 'deterministic-fallback');
  assert.equal(result.workflow.answer.model_rejected_reason, 'deadline');
});

test('a generous scan deadline lets a fast real model answer normally', async () => {
  const fastPrimary = { name: 'fast-model', model: 'fast-v1', async checkReady() { return true; }, async generate() { return { text: '{"claims":[]}', inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 }; } };
  const answerProvider = new ResilientProvider({ primary: fastPrimary, fallback: new DeterministicAnswerComposer() });
  const { run } = serviceWith({ answerProvider, scanDeadlineMs: 25000 });
  const result = await run();
  assert.equal(result.workflow.answer.model_rejected_reason, 'all_claims_unverified'); // empty claims never verify anything -> forced fallback, but not a deadline
});

// F8: a live OpenEMR chart with no explicit external-provider approval never
// reaches a real model for the answer either (mirrors briefings).
test('allowExternalLiveProvider: false forces the deterministic composer for a live chart adapter', async () => {
  const fakePrimary = { name: 'fake-model', model: 'fake-v1', async checkReady() { return true; }, async generate() { throw new Error('should never be called for a live adapter without approval'); } };
  const answerProvider = new ResilientProvider({ primary: fakePrimary, fallback: new DeterministicAnswerComposer() });
  const { run } = serviceWith({ answerProvider, allowExternalLiveProvider: false, chartAdapter: { name: 'openemr-rest', authorize: () => ({ status: 'authorized', patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }), getCase: async () => { throw new Error('PATIENT_NOT_FOUND'); }, getPatientDemographics: async () => null } });
  const result = await run();
  assert.equal(result.workflow.answer.composer, 'deterministic-fallback');
  assert.equal('model_rejected_reason' in result.workflow.answer, false);
});

// F10: the server never persists derived facts from a workflow whose answer
// fails its own contract -- it answers 500 before attempting the write.
test('the HTTP boundary refuses to send (and, per code order, to persist from) a workflow whose answer fails contract validation', async () => {
  const port = 18901;
  const child = await startTestServer(port, { AGENTFORGE_TEST_INVALID_ANSWER: 'true' });
  try {
    const patient = 'fixture-patient-001';
    const readContext = await fetch(`http://127.0.0.1:${port}/v1/demo-context?patient_uuid=${patient}`).then((response) => response.json());
    const writeContext = await fetch(`http://127.0.0.1:${port}/v1/source-document-context?patient_uuid=${patient}`).then((response) => response.json());
    const content = labA();
    const upload = await fetch(`http://127.0.0.1:${port}/v1/source-documents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', demo_token: writeContext.demo_token, document_type: 'lab_pdf', filename: 'lab-a.pdf', content_base64: content.toString('base64') }) }).then((response) => response.json());
    const workflowResponse = await fetch(`http://127.0.0.1:${port}/v1/scan-supervisor`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', demo_token: readContext.demo_token, source_document_id: upload.source_document.id, message: 'documented glycemic values medication adherence' }) });
    assert.equal(workflowResponse.status, 500);
    assert.deepEqual(await workflowResponse.json(), { error: 'response_contract_invalid' });
  } finally {
    child.kill();
  }
});
