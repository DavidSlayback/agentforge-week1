import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { SimulatedOpenEMRAdapter } from '../src/openemrAdapter.js';
import { AgentForgeService } from '../src/service.js';
import { DeterministicProvider } from '../src/modelProvider.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';

const fixturePath = fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url));
const adapter = new SimulatedOpenEMRAdapter({ fixturePath });
const request = (patient_uuid, clinician_uuid = 'fixture-physician-001') => ({ patient_uuid, clinician_uuid });
const signedContext = (patient_uuid, clinician_uuid = 'fixture-physician-001') => verifySignedContext(issueSignedContext({ patient_uuid, clinician_uuid, secret: 'test-secret', ttlSeconds: 300 }), 'test-secret');

test('simulated OpenEMR seam accepts matching signed identity and scope', () => {
  const result = adapter.authorize(request('fixture-patient-001'), signedContext('fixture-patient-001'));
  assert.equal(result.status, 'authorized');
  assert.equal(result.source, 'signed-user-context');
  assert.equal(adapter.getCase(result.patient_uuid, 'complete_return_visit').patient.patient_ref, 'fixture-patient-001');
});

test('simulated OpenEMR seam blocks missing, mismatched, and non-read contexts', () => {
  assert.equal(adapter.authorize(request('fixture-patient-001'), null).reason, 'server_context_missing_or_invalid');
  assert.equal(adapter.authorize(request('fixture-patient-001'), signedContext('fixture-patient-006')).reason, 'server_context_mismatch');
  assert.equal(adapter.authorize(request('fixture-patient-001'), { ...signedContext('fixture-patient-001'), scope: 'write-chart' }).status, 'blocked');
});

test('fixture parity preserves coverage semantics at the OpenEMR seam', () => {
  const item = adapter.getCase('fixture-patient-006', 'partial_retrieval');
  const retrieved = adapter.retrieve(item);
  assert.equal(retrieved.coverage.some((group) => group.status === 'timeout'), true);
  assert.equal(retrieved.coverage.some((group) => group.status === 'failed'), true);
});

test('coverage-scoped retrieval excludes records from failed and timed-out groups', () => {
  const item = adapter.getCase('fixture-patient-006', 'partial_retrieval');
  const mutated = { ...item, records: [...item.records,
    { field: 'encounter.summary', value: 'failed synthetic encounter', source_ref: 'enc-failed' },
    { field: 'note.body', value: 'timed out synthetic note', source_ref: 'note-timeout' },
  ] };
  const retrieved = adapter.retrieve(mutated);
  assert.deepEqual(retrieved.records.map((record) => record.source_ref), ['problem-601']);
});

test('service requires the verified synthetic session when the seam is strict', async () => {
  const service = new AgentForgeService({ adapter, provider: new DeterministicProvider() });
  const request = { patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', case_id: 'complete_return_visit', correlation_id: 'strict-context-test' };
  assert.equal((await service.prepare(request)).disposition, 'blocked');
  const result = await service.prepare(request, { verifiedContext: signedContext('fixture-patient-001') });
  assert.equal(result.disposition, 'complete');
});
