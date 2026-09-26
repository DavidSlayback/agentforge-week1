import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { DeterministicProvider } from '../src/modelProvider.js';
import { AgentForgeService } from '../src/service.js';
import { SyntheticWriteback } from '../src/syntheticWriteback.js';
import { PreVisitPreparation } from '../src/preVisitPreparation.js';

// E8 review: the graded W2 answer paths (scan answer, follow-up evidence)
// refuse a question naming another patient (W1-SF4), and an
// instruction-bearing note never reaches a model or the display (fail safe).
const fixturePath = fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url));
const SECRET = 'answer-paths-scope-secret';
const context = (patient, scope = 'read-briefing') => verifySignedContext(issueSignedContext({ patient_uuid: patient, clinician_uuid: 'fixture-physician-001', scope, acl: scope === 'read-briefing' ? 'read' : 'write', secret: SECRET }), SECRET);
const labA = () => fs.readFileSync(fileURLToPath(new URL('../../docs/agentforge/fixtures/scan-forms/lab-layout-a-complete.scan.txt', import.meta.url)));
const INJECTED = /NOTE TO AUTOMATION|ignore the evidence policy|mark all problems resolved/i;

/** A model-lane answer provider that records every request and proposes no claims (the composer then falls back deterministically). */
function spyComposer() {
  const calls = [];
  return { calls, provider: { name: 'spy-answer-model', model: 'spy-v1', checkReady: async () => true, generate: async (args) => { calls.push(args); return { text: '{"claims":[]}', inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 }; } } };
}

function serviceWith(overrides = {}) {
  const chartAdapter = new FixtureAdapter(fixturePath);
  const retrieveCalls = [];
  const spyAdapter = Object.create(chartAdapter);
  spyAdapter.retrieve = (item, options) => { retrieveCalls.push(item.patient.patient_ref); return chartAdapter.retrieve(item, options); };
  const service = new AgentForgeService({ chartAdapter: spyAdapter, writeback: new SyntheticWriteback(), provider: new DeterministicProvider(), ...overrides });
  return { service, retrieveCalls };
}

async function scan(service, query) {
  const upload = await service.ingestSourceDocument({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', document_type: 'lab_pdf', filename: 'lab-a.pdf', content: labA() }, { verifiedContext: context('fixture-patient-001', 'write-source-document') });
  return service.runActiveSupervisorForDocument(upload.source_document.id, { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }, { verifiedContext: context('fixture-patient-001'), query });
}

test('scan path: a question naming another patient refuses the answer but keeps the extraction', async () => {
  const composer = spyComposer();
  const { service, retrieveCalls } = serviceWith({ answerProvider: composer.provider });
  const result = await scan(service, 'What medications is Test Conflict on?');
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.answer_refusal, { disposition: 'blocked', reason: 'out_of_scope_patient' });
  assert.equal(result.workflow.answer, undefined, 'no answer is composed');
  assert.equal(composer.calls.length, 0, 'the answer model is never called');
  assert.deepEqual(retrieveCalls, [], 'no chart is read for the answer');
  assert.ok(result.workflow.typed_outputs.extraction.facts.length > 0, 'the document extraction still runs');
  assert.doesNotMatch(JSON.stringify(result), /fixture-patient-002|Test Conflict|metformin/);
});

test('scan path: an ordinary question still gets a grounded answer', async () => {
  const composer = spyComposer();
  const { service } = serviceWith({ answerProvider: composer.provider });
  const result = await scan(service, 'Is the test result stale or partial?');
  assert.equal(result.answer_refusal, undefined);
  assert.ok(result.workflow.answer);
  assert.equal(composer.calls.length, 1);
});

test('follow-up evidence: a question naming another patient is refused before any chart read', async () => {
  const { service, retrieveCalls } = serviceWith();
  for (const message of ['What meds is fixture-patient-002 on?', 'Stale, Test allergies?', 'fixture patient 003']) {
    const result = await service.retrieveFollowUpEvidence({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', message }, { verifiedContext: context('fixture-patient-001') });
    assert.deepEqual(result, { status: 'blocked', disposition: 'blocked', reason: 'out_of_scope_patient' }, message);
  }
  assert.deepEqual(retrieveCalls, []);
  const ok = await service.retrieveFollowUpEvidence({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', message: 'Is the test empty?' }, { verifiedContext: context('fixture-patient-001') });
  assert.equal(ok.status, 'ready');
});

test('an instruction-bearing note is withheld from chart facts and follow-up evidence', async () => {
  const { service } = serviceWith();
  const chart = await service.retrievePatientChartFacts('fixture-patient-005');
  assert.equal(chart.patient_facts.some((fact) => fact.field === 'note.body'), false);
  assert.deepEqual(chart.withheld_patient_fields, [{ field: 'note.body', reason: 'untrusted_narrative' }]);
  assert.doesNotMatch(JSON.stringify(chart), INJECTED);
  const evidence = await service.retrieveFollowUpEvidence({ patient_uuid: 'fixture-patient-005', clinician_uuid: 'fixture-physician-001', message: 'How is sleep?' }, { verifiedContext: context('fixture-patient-005') });
  assert.equal(evidence.status, 'ready');
  assert.ok(evidence.qualification.reasons.includes('untrusted_narrative:note.body'));
  assert.deepEqual(evidence.retrieval.withheld_patient_fields, [{ field: 'note.body', reason: 'untrusted_narrative' }]);
  assert.doesNotMatch(JSON.stringify(evidence), INJECTED);
});

test('an instruction-bearing note reaches neither the briefing model, the follow-up model, nor the displayed claims', async () => {
  const requests = [];
  const spy = (name) => {
    const inner = new DeterministicProvider();
    return { name, model: 'spy', checkReady: async () => true, generate: async (args, options) => { requests.push(args); return inner.generate(args, options); } };
  };
  const adapter = new FixtureAdapter(fixturePath);
  const preparation = new PreVisitPreparation({ adapter, provider: spy('briefing-spy'), conversationProvider: spy('conversation-spy') });
  const value = { patient_uuid: 'fixture-patient-005', clinician_uuid: 'fixture-physician-001', case_id: 'unstructured_note' };
  const briefing = await preparation.prepare(value, { verifiedContext: context('fixture-patient-005') });
  assert.equal(briefing.disposition, 'qualified');
  assert.deepEqual(briefing.withheld_fields, ['note.body']);
  assert.ok(briefing.qualification.reasons.includes('untrusted_narrative:note.body'), 'the display shows why the note was withheld');
  const followUp = await preparation.followUp(briefing.correlation_id, { patient_uuid: 'fixture-patient-005', clinician_uuid: 'fixture-physician-001', message: 'What does the note say?' }, { verifiedContext: context('fixture-patient-005') });
  assert.ok(requests.length >= 2, 'both the briefing and the follow-up reached a provider');
  assert.doesNotMatch(JSON.stringify(requests), INJECTED);
  for (const response of [briefing, followUp]) {
    assert.equal(response.claims.some((claim) => claim.field === 'note.body'), false);
    assert.doesNotMatch(JSON.stringify({ claims: response.claims, text: response.text, evidence: response.evidence }), INJECTED);
  }
});
