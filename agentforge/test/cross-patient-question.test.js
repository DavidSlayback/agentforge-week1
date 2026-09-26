import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { DeterministicProvider } from '../src/modelProvider.js';
import { AgentForgeService } from '../src/service.js';
import { InMemoryTraceSink } from '../../observability/index.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';
import { mentionsOtherPatient } from '../src/patientMentions.js';

// W1-SF4: a follow-up question that names another patient is refused
// explicitly, without disclosing either patient's chart.
const adapter = new FixtureAdapter(fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url)));
const request = (patient_uuid, extra = {}) => ({ patient_uuid, clinician_uuid: 'fixture-physician-001', ...extra });
const contextFor = (value) => verifySignedContext(issueSignedContext({ patient_uuid: value.patient_uuid, clinician_uuid: value.clinician_uuid, secret: 'test-secret' }), 'test-secret');

async function briefedService(traceSink = undefined) {
  const service = new AgentForgeService({ adapter, provider: new DeterministicProvider(), traceSink });
  const value = request('fixture-patient-001', { case_id: 'complete_return_visit' });
  const briefing = await service.prepare(value, { verifiedContext: contextFor(value) });
  assert.equal(briefing.disposition, 'complete');
  const ask = (message) => { const followUp = request('fixture-patient-001', { message }); return service.followUp(briefing.correlation_id, followUp, { verifiedContext: contextFor(followUp) }); };
  return { service, briefing, ask };
}

// Words from each patient's chart that must never appear in a refusal.
const PATIENT_001_DATA = ['Test Patient One', 'lisinopril', 'hypertension', 'blood-pressure', '1980-04-12'];
const PATIENT_002_DATA = ['Test Conflict', 'metformin', '1968-07-21'];

for (const [label, message] of [
  ['a synthetic patient ref', 'What meds is fixture-patient-002 on?'],
  ['another patient\'s name', 'What meds is Test Conflict on?'],
  ['another patient\'s chart id', 'Summarize the chart for fixture-pid-a.'],
  ['an OpenEMR-style patient uuid', 'What changed for patient 3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c?'],
]) {
  test(`a follow-up naming ${label} is refused without disclosure`, async () => {
    const { service, briefing, ask } = await briefedService();
    const historyBefore = service.preparation.cache.get(briefing.correlation_id).entry.history?.length || 0;
    const result = await ask(message);
    assert.equal(result.disposition, 'blocked');
    assert.deepEqual(result.qualification.reasons, ['out_of_scope_patient']);
    assert.equal(result.patient, null);
    assert.deepEqual(result.claims, []);
    assert.equal('text' in result, false);
    assert.equal('evidence' in result, false);
    const serialized = JSON.stringify(result);
    for (const word of [...PATIENT_001_DATA, ...PATIENT_002_DATA, 'fixture-patient-002', 'fixture-pid-a']) assert.equal(serialized.includes(word), false, word);
    assert.equal(service.preparation.cache.get(briefing.correlation_id).entry.history?.length || 0, historyBefore, 'a refused question is not added to the conversation');
  });
}

test('the refusal trace is blocked and carries no identifier from the question', async () => {
  const sink = new InMemoryTraceSink();
  const { ask } = await briefedService(sink);
  await ask('What meds is fixture-patient-002 on?');
  const trace = sink.list().at(-1);
  assert.equal(trace.status, 'blocked');
  assert.equal(trace.display.status, 'withheld');
  assert.doesNotMatch(JSON.stringify(trace), /fixture-patient-00[12]|Test Conflict|metformin/);
});

test('ordinary questions about the current patient are answered, not refused', async () => {
  const { ask } = await briefedService();
  for (const message of ['What meds is the patient on?', 'What changed since the last visit?', 'What meds is fixture-patient-001 on?', 'What changed for Test Patient One?', 'Is the lisinopril dose different from the last test?']) {
    const result = await ask(message);
    assert.notEqual(result.disposition, 'blocked', message);
    assert.equal(result.patient.patient_ref, 'fixture-patient-001', message);
  }
});

test('mentionsOtherPatient ignores the current patient\'s own identifiers', () => {
  const knownPatients = adapter.listPatientIdentifiers();
  const dup = { patient_ref: 'fixture-patient-dup', display_name: 'Test Duplicate' };
  assert.equal(mentionsOtherPatient({ message: 'Which chart is fixture-pid-a or fixture-pid-b?', currentPatient: dup, knownPatients }), false);
  assert.equal(mentionsOtherPatient({ message: 'Compare with Test Patient One', currentPatient: dup, knownPatients }), true);
  assert.equal(mentionsOtherPatient({ message: 'Any allergy test results?', currentPatient: dup, knownPatients }), false);
  assert.equal(mentionsOtherPatient({ message: '', currentPatient: dup, knownPatients }), false);
});
