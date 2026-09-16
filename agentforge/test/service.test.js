import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { DeterministicProvider } from '../src/modelProvider.js';
import { AgentForgeService } from '../src/service.js';
import { InMemoryTraceSink } from '../../observability/index.js';

const adapter = new FixtureAdapter(path.resolve(process.cwd(), 'docs/agentforge/fixtures/clinical-cases.json'));
const make = () => new AgentForgeService({ adapter, provider: new DeterministicProvider() });
const request = (patient_uuid, extra = {}) => ({ patient_uuid, clinician_uuid: 'fixture-physician-001', authorization: { status: 'authorized', scope: 'read-briefing' }, correlation_id: 'test-correlation', ...extra });

test('prepares a grounded complete briefing', async () => { const result = await make().prepare(request('fixture-patient-001', { case_id: 'complete_return_visit' })); assert.equal(result.disposition, 'complete'); assert.equal(result.verification.status, 'passed'); assert.ok(result.claims.every((claim) => claim.evidence.length)); });
test('blocks missing authorization without patient data', async () => { const result = await make().prepare({ patient_uuid: 'fixture-patient-001', clinician_uuid: '', authorization: { status: 'denied' } }); assert.equal(result.disposition, 'blocked'); assert.equal(result.patient, null); });
test('qualifies partial retrieval and withholds dependent claims', async () => { const result = await make().prepare(request('fixture-patient-006', { case_id: 'partial_retrieval' })); assert.equal(result.disposition, 'partial'); assert.equal(result.qualification.required, true); assert.deepEqual(result.withheld_fields, ['encounter_summary', 'note_summary']); });
test('isolates follow-up conversations by patient', async () => { const svc = make(); await svc.prepare(request('fixture-patient-001', { case_id: 'complete_return_visit' })); const result = await svc.followUp('test-correlation', request('fixture-patient-006', { message: 'What changed?' })); assert.equal(result.disposition, 'blocked'); });
test('records the request lifecycle with verification and display outcomes', async () => { const sink = new InMemoryTraceSink(); const svc = new AgentForgeService({ adapter, provider: new DeterministicProvider(), traceSink: sink }); await svc.prepare(request('fixture-patient-001', { case_id: 'complete_return_visit' })); const trace = sink.list()[0]; assert.deepEqual(trace.stages.map((stage) => stage.name), ['authorization', 'retrieval', 'verification', 'model']); assert.equal(trace.verification.status, 'passed'); assert.equal(trace.display.status, 'displayed'); });
