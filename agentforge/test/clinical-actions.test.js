import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SyntheticClinicalActionStore } from '../src/clinicalActions.js';
import { SimulatedOpenEMRAdapter } from './helpers/simulatedOpenemrAdapter.js';
import { AgentForgeService } from '../src/service.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';
import { startTestServer, DEMO_KEY_REQUEST } from './helpers/testServer.js';

const fixturePath = fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const actionRequest = (action_type, instruction, patient_uuid = 'fixture-patient-001') => ({
  patient_uuid,
  clinician_uuid: 'fixture-physician-001',
  action_type,
  instruction,
  instruction_source: 'clinician',
});
const actionContext = (patient_uuid, clinician_uuid = 'fixture-physician-001') => verifySignedContext(issueSignedContext({ patient_uuid, clinician_uuid, scope: 'write-clinical-action', acl: 'write', secret: 'synthetic-test-secret' }), 'synthetic-test-secret');

test('clinical action drafts are structured, explicit-source, and uncommitted', () => {
  const store = new SyntheticClinicalActionStore({ now: () => '2026-09-21T20:00:00.000Z' });
  const diagnosis = store.draft({ patientRef: 'fixture-patient-001', clinicianRef: 'fixture-physician-001', actionType: 'diagnosis', instruction: 'Add hypertension as a diagnosis', instructionSource: 'clinician' });
  const order = store.draft({ patientRef: 'fixture-patient-001', clinicianRef: 'fixture-physician-001', actionType: 'order', instruction: 'Order a basic metabolic panel', instructionSource: 'clinician' });

  assert.equal(diagnosis.duplicate, false);
  assert.equal(diagnosis.action.status, 'draft');
  assert.equal(diagnosis.action.resource.resource_type, 'Condition');
  assert.equal(order.action.resource.resource_type, 'ServiceRequest');
  assert.equal(diagnosis.action.provenance, 'clinician-authored-unconfirmed');
  assert.equal(store.list('fixture-patient-001').length, 0);
  assert.throws(() => store.draft({ patientRef: 'fixture-patient-001', clinicianRef: 'fixture-physician-001', actionType: 'diagnosis', instruction: 'Invent a diagnosis', instructionSource: 'agent' }), /CLINICAL_ACTION_INSTRUCTION_SOURCE_INVALID/);
});

test('clinical action confirmation requires explicit clinician event and is idempotent', () => {
  const store = new SyntheticClinicalActionStore({ now: () => '2026-09-21T20:00:00.000Z' });
  const draft = store.draft({ patientRef: 'fixture-patient-001', clinicianRef: 'fixture-physician-001', actionType: 'order', instruction: 'Order a basic metabolic panel', instructionSource: 'clinician' }).action;
  assert.throws(() => store.confirm(draft.id, { patientRef: draft.patient_ref, clinicianRef: draft.clinician_uuid, confirmationEvent: { confirmed: true, event_id: 'evt-1', actor: 'agent' } }), /CLINICAL_ACTION_ACTOR_INVALID/);

  const cancelled = store.confirm(draft.id, { patientRef: draft.patient_ref, clinicianRef: draft.clinician_uuid, confirmationEvent: { confirmed: false, event_id: 'evt-cancel', actor: 'clinician', cancel_reason: 'review later' } });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(store.list('fixture-patient-001').length, 0);

  const secondDraft = store.draft({ patientRef: 'fixture-patient-001', clinicianRef: 'fixture-physician-001', actionType: 'order', instruction: 'Order a CBC', instructionSource: 'clinician' }).action;
  const first = store.confirm(secondDraft.id, { patientRef: secondDraft.patient_ref, clinicianRef: secondDraft.clinician_uuid, confirmationEvent: { confirmed: true, event_id: 'evt-2', actor: 'clinician' } });
  const retry = store.confirm(secondDraft.id, { patientRef: secondDraft.patient_ref, clinicianRef: secondDraft.clinician_uuid, confirmationEvent: { confirmed: true, event_id: 'evt-2', actor: 'clinician' } });
  assert.equal(first.action.status, 'confirmed');
  assert.equal(first.action.provenance, 'synthetic-openemr-clinician-confirmed');
  assert.equal(retry.duplicate, true);
  assert.equal(retry.action.id, first.action.id);
  assert.throws(() => store.get(first.action.id, { patientRef: 'fixture-patient-002', clinicianRef: 'fixture-physician-001' }), /CLINICAL_ACTION_SCOPE_MISMATCH/);
});

test('service requires the action write context and surfaces persistence failure', () => {
  const failingStore = new SyntheticClinicalActionStore({ persist() { throw Object.assign(new Error('CLINICAL_ACTION_PERSISTENCE_FAILED'), { code: 'CLINICAL_ACTION_PERSISTENCE_FAILED' }); } });
  const failingAdapter = new SimulatedOpenEMRAdapter({ fixturePath, clinicalActionStore: failingStore });
  const service = new AgentForgeService({ adapter: failingAdapter });
  const draft = service.draftClinicalAction(actionRequest('diagnosis', 'Add hypertension as a diagnosis'), { verifiedContext: actionContext('fixture-patient-001') });
  assert.equal(draft.status, 'drafted');
  assert.equal(service.draftClinicalAction(actionRequest('diagnosis', 'Add hypertension as a diagnosis'), { verifiedContext: verifySignedContext(issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', secret: 'synthetic-test-secret' }), 'synthetic-test-secret') }).status, 'blocked');
  assert.throws(() => service.confirmClinicalAction(draft.action.id, { ...actionRequest('diagnosis', 'Add hypertension as a diagnosis'), confirmation_event: { confirmed: true, event_id: 'evt-failure', actor: 'clinician' } }, { verifiedContext: actionContext('fixture-patient-001') }), /CLINICAL_ACTION_PERSISTENCE_FAILED/);
});

const startServer = (port, extraEnv = {}, waitPath = '/ready') => startTestServer(port, extraEnv, { path: waitPath });

test('clinical action API drafts, confirms, reads back, cancels, and blocks unsafe routes', async () => {
  const port = 18808;
  const child = await startServer(port);
  try {
    const patient = 'fixture-patient-001';
    const context = await fetch(`http://127.0.0.1:${port}/v1/clinical-action-context?patient_uuid=${patient}`, DEMO_KEY_REQUEST).then((response) => response.json());
    assert.equal(context.scope, 'write-clinical-action');
    const base = { patient_uuid: patient, clinician_uuid: 'fixture-physician-001', demo_token: context.demo_token, action_type: 'diagnosis', instruction: 'Add hypertension as a diagnosis', instruction_source: 'clinician' };
    const draftResponse = await fetch(`http://127.0.0.1:${port}/v1/clinical-actions/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(base) });
    assert.equal(draftResponse.status, 200);
    const draft = await draftResponse.json();
    assert.equal(draft.action.status, 'draft');
    assert.equal(draft.action.resource.resource_type, 'Condition');

    const confirmedResponse = await fetch(`http://127.0.0.1:${port}/v1/clinical-actions/${draft.action.id}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, confirmation_event: { confirmed: true, event_id: 'evt-api-1', actor: 'clinician' } }) });
    assert.equal(confirmedResponse.status, 200);
    const confirmed = await confirmedResponse.json();
    assert.equal(confirmed.status, 'confirmed');
    assert.equal(confirmed.action.authored_by, 'fixture-physician-001');
    assert.equal(confirmed.action.confirmation_event_id, 'evt-api-1');

    const retry = await fetch(`http://127.0.0.1:${port}/v1/clinical-actions/${draft.action.id}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, confirmation_event: { confirmed: true, event_id: 'evt-api-1', actor: 'clinician' } }) }).then((response) => response.json());
    assert.equal(retry.duplicate, true);
    const readback = await fetch(`http://127.0.0.1:${port}/v1/clinical-actions/${draft.action.id}?patient_uuid=${patient}&demo_token=${encodeURIComponent(context.demo_token)}`);
    assert.equal(readback.status, 200);
    assert.equal((await readback.json()).action.provenance, 'synthetic-openemr-clinician-confirmed');

    const cancelledDraft = await fetch(`http://127.0.0.1:${port}/v1/clinical-actions/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, action_type: 'order', instruction: 'Order a CBC' }) }).then((response) => response.json());
    const cancelled = await fetch(`http://127.0.0.1:${port}/v1/clinical-actions/${cancelledDraft.action.id}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, action_type: 'order', instruction: 'Order a CBC', confirmation_event: { confirmed: false, event_id: 'evt-cancel-api', actor: 'clinician' } }) });
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).status, 'cancelled');
    const cancelledReadback = await fetch(`http://127.0.0.1:${port}/v1/clinical-actions/${cancelledDraft.action.id}?patient_uuid=${patient}&demo_token=${encodeURIComponent(context.demo_token)}`);
    assert.equal(cancelledReadback.status, 404);

    const agentOriginated = await fetch(`http://127.0.0.1:${port}/v1/clinical-actions/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, instruction_source: 'agent' }) });
    assert.equal(agentOriginated.status, 400);
    const otherContext = await fetch(`http://127.0.0.1:${port}/v1/clinical-action-context?patient_uuid=fixture-patient-002`, DEMO_KEY_REQUEST).then((response) => response.json());
    const wrongPatient = await fetch(`http://127.0.0.1:${port}/v1/clinical-actions/${draft.action.id}?patient_uuid=fixture-patient-002&demo_token=${encodeURIComponent(otherContext.demo_token)}`);
    assert.equal(wrongPatient.status, 403);
  } finally { child.kill(); }
});

test('clinical action API reports writeback failure and live mode stays write-disabled', async () => {
  const failurePort = 18809;
  const failureChild = await startServer(failurePort, { AGENTFORGE_TEST_CLINICAL_ACTION_FAILURE: 'true' });
  try {
    const patient = 'fixture-patient-001';
    const context = await fetch(`http://127.0.0.1:${failurePort}/v1/clinical-action-context?patient_uuid=${patient}`, DEMO_KEY_REQUEST).then((response) => response.json());
    const base = { patient_uuid: patient, clinician_uuid: 'fixture-physician-001', demo_token: context.demo_token, action_type: 'order', instruction: 'Order a CBC', instruction_source: 'clinician' };
    const draft = await fetch(`http://127.0.0.1:${failurePort}/v1/clinical-actions/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(base) }).then((response) => response.json());
    const response = await fetch(`http://127.0.0.1:${failurePort}/v1/clinical-actions/${draft.action.id}/confirm`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...base, confirmation_event: { confirmed: true, event_id: 'evt-failure-api', actor: 'clinician' } }) });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).error, 'CLINICAL_ACTION_PERSISTENCE_FAILED');
  } finally { failureChild.kill(); }

  const livePort = 18810;
  const liveChild = await startServer(livePort, { AGENTFORGE_OPENEMR_MODE: 'live', AGENTFORGE_OPENEMR_BASE_URL: 'http://openemr', AGENTFORGE_OPENEMR_ACCESS_TOKEN: '' }, '/health');
  try {
    const response = await fetch(`http://127.0.0.1:${livePort}/v1/clinical-actions/drafts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ patient_uuid: 'patient-uuid', clinician_uuid: 'clinician-uuid', demo_token: 'not-valid', action_type: 'diagnosis', instruction: 'Add diagnosis', instruction_source: 'clinician' }) });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'synthetic_writeback_only');
  } finally { liveChild.kill(); }
});
