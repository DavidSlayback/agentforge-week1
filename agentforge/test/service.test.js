import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { DeterministicProvider } from '../src/modelProvider.js';
import { AgentForgeService } from '../src/service.js';
import { PreparationCache } from '../src/preparationCache.js';
import { InMemoryTraceSink } from '../../observability/index.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';

const adapter = new FixtureAdapter(fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url)));
const make = () => new AgentForgeService({ adapter, provider: new DeterministicProvider() });
const request = (patient_uuid, extra = {}) => ({ patient_uuid, clinician_uuid: 'fixture-physician-001', correlation_id: 'test-correlation', ...extra });
const contextFor = (value) => verifySignedContext(issueSignedContext({ patient_uuid: value.patient_uuid, clinician_uuid: value.clinician_uuid, secret: 'test-secret' }), 'test-secret');
const prepareWithContext = (service, value, options = {}) => service.prepare(value, { ...options, verifiedContext: contextFor(value) });
const followUpWithContext = (service, id, value, options = {}) => service.followUp(id, value, { ...options, verifiedContext: contextFor(value) });

test('prepares a grounded complete briefing', async () => { const value = request('fixture-patient-001', { case_id: 'complete_return_visit' }); const result = await prepareWithContext(make(), value); assert.equal(result.disposition, 'complete'); assert.equal(result.verification.status, 'passed'); assert.ok(result.claims.every((claim) => claim.evidence.length)); });
test('blocks missing signed context without patient data', async () => { const result = await make().prepare({ patient_uuid: 'fixture-patient-001', clinician_uuid: '' }); assert.equal(result.disposition, 'blocked'); assert.equal(result.patient, null); });
test('qualifies partial retrieval and withholds dependent claims', async () => { const value = request('fixture-patient-006', { case_id: 'partial_retrieval' }); const result = await prepareWithContext(make(), value); assert.equal(result.disposition, 'partial'); assert.equal(result.qualification.required, true); assert.deepEqual(result.withheld_fields, ['encounter_summary', 'note_summary']); });
test('service cannot expose records returned from failed or timed-out coverage groups', async () => {
  const scopedAdapter = Object.create(adapter);
  scopedAdapter.getCase = (patientRef, caseId) => {
    const item = adapter.getCase(patientRef, caseId);
    return { ...item, records: [...item.records,
      { field: 'encounter.summary', value: 'failed synthetic encounter', recorded_at: '2026-09-15T09:00:00Z', author: 'fixture-clinician-a', source_ref: 'enc-failed' },
      { field: 'note.body', value: 'timed out synthetic note', recorded_at: '2026-09-15T09:01:00Z', author: 'fixture-clinician-a', source_ref: 'note-timeout' },
    ] };
  };
  const service = new AgentForgeService({ adapter: scopedAdapter, provider: new DeterministicProvider() });
  const value = request('fixture-patient-006', { case_id: 'partial_retrieval' });
  const result = await prepareWithContext(service, value);
  assert.deepEqual(result.claims.map((claim) => claim.source_ref), ['problem-601']);
});
test('service never relabels an explicitly cross-patient source record', async () => {
  const scopedAdapter = Object.create(adapter);
  scopedAdapter.getCase = (patientRef, caseId) => {
    const item = adapter.getCase(patientRef, caseId);
    return { ...item, records: [...item.records, { field: 'problem.cross_patient.status', value: 'must not surface', patient_ref: 'fixture-patient-999', source_ref: 'problem-leak' }] };
  };
  const service = new AgentForgeService({ adapter: scopedAdapter, provider: new DeterministicProvider() });
  const value = request('fixture-patient-001', { case_id: 'complete_return_visit' });
  const result = await prepareWithContext(service, value);
  assert.equal(result.claims.some((claim) => claim.source_ref === 'problem-leak'), false);
});
test('failed verification prevents synthesis, display, and cache writes', async () => {
  let providerCalled = false;
  const invalidCoverageAdapter = Object.create(adapter);
  invalidCoverageAdapter.retrieve = async (item) => ({ records: [], coverage: [{ group: 'notes', status: 'invalid-status', records: 0, attempts: 1, error_class: 'fixture-error' }] });
  const provider = { name: 'spy', model: 'spy', generate: async () => { providerCalled = true; throw new Error('provider must not be called'); } };
  const cache = new PreparationCache();
  const svc = new AgentForgeService({ adapter: invalidCoverageAdapter, provider, cache });
  const value = request('fixture-patient-001', { case_id: 'complete_return_visit', correlation_id: 'verification-stop' });
  const result = await prepareWithContext(svc, value);
  assert.equal(result.disposition, 'blocked');
  assert.equal(result.verification.status, 'blocked');
  assert.equal(providerCalled, false);
  assert.equal(cache.get('verification-stop').status, 'miss');
});
test('isolates follow-up conversations by patient', async () => { const svc = make(); const first = request('fixture-patient-001', { case_id: 'complete_return_visit' }); await prepareWithContext(svc, first); const second = request('fixture-patient-006', { message: 'What changed?' }); const result = await followUpWithContext(svc, 'test-correlation', second); assert.equal(result.disposition, 'blocked'); });
test('records the request lifecycle with opaque trace correlation and verification/display outcomes', async () => { const sink = new InMemoryTraceSink(); const svc = new AgentForgeService({ adapter, provider: new DeterministicProvider(), traceSink: sink }); const value = request('fixture-patient-001', { case_id: 'complete_return_visit', correlation_id: 'fixture-patient-001-clinician-secret' }); await prepareWithContext(svc, value); const trace = sink.list()[0]; assert.match(trace.correlationId, /^af-[0-9a-f]{32}$/); assert.doesNotMatch(JSON.stringify(trace), /fixture-patient-001-clinician-secret|fixture-patient-001|fixture-physician-001/); assert.deepEqual(trace.stages.map((stage) => stage.name), ['authorization', 'retrieval', 'verification', 'model', 'display']); assert.equal(trace.verification.status, 'passed'); assert.equal(trace.display.status, 'displayed'); });

test('uses a server-owned preparation cache and records interaction latency', async () => {
  const sink = new InMemoryTraceSink();
  const cache = new PreparationCache({ ttlMs: 100, now: () => 0 });
  const svc = new AgentForgeService({ adapter, provider: new DeterministicProvider(), traceSink: sink, cache });
  const first = request('fixture-patient-001', { case_id: 'complete_return_visit' });
  const briefing = await prepareWithContext(svc, first);
  const second = request('fixture-patient-001', { message: 'What changed?' });
  const followUp = await followUpWithContext(svc, briefing.correlation_id, second);
  assert.equal(followUp.disposition, 'complete');
  const traces = sink.list();
  assert.equal(traces[0].interactionType, 'briefing');
  assert.equal(traces[0].cache.status, 'stored');
  assert.equal(typeof traces[0].latencyMs.synthesis, 'number');
  assert.equal(traces[1].interactionType, 'cache_followup');
  assert.equal(traces[1].cache.status, 'hit');
  assert.equal(sink.snapshot().latencyByInteraction.cache_followup.p95, traces[1].durationMs);
});

test('bounds preparation cache entries and removes expired state', () => {
  let now = 0;
  const cache = new PreparationCache({ ttlMs: 10, maxEntries: 2, now: () => now });
  const entry = (correlationId) => ({ correlationId, patientRef: 'patient', clinicianRef: 'clinician', verifiedContext: {}, request: {}, response: {} });
  cache.put(entry('first'));
  cache.put(entry('second'));
  cache.put(entry('third'));
  assert.equal(cache.get('first').status, 'miss');
  assert.equal(cache.get('second').status, 'hit');
  now = 11;
  assert.equal(cache.get('second').status, 'stale');
  assert.equal(cache.get('third').status, 'stale');
});

test('stale preparation cache refreshes through a bounded fresh retrieval', async () => {
  let now = 0;
  const cache = new PreparationCache({ ttlMs: 10, now: () => now });
  const sink = new InMemoryTraceSink();
  const svc = new AgentForgeService({ adapter, provider: new DeterministicProvider(), traceSink: sink, cache, freshRetrievalDeadlineMs: 50 });
  const first = request('fixture-patient-001', { case_id: 'complete_return_visit' });
  const briefing = await prepareWithContext(svc, first);
  now = 11;
  const second = request('fixture-patient-001', { message: 'What changed?' });
  const followUp = await followUpWithContext(svc, briefing.correlation_id, second);
  assert.equal(followUp.disposition, 'complete');
  assert.equal(sink.snapshot().cacheOutcomes.stale, 1);
  assert.equal(sink.list().some((trace) => trace.interactionType === 'fresh_followup' && trace.deadlineOutcome === 'within_deadline'), true);
});

test('stale preparation is discarded before a failed refresh', async () => {
  let now = 0;
  const cache = new PreparationCache({ ttlMs: 10, now: () => now });
  const failedAdapter = Object.create(adapter);
  failedAdapter.retrieve = (item) => adapter.retrieve(item);
  const svc = new AgentForgeService({ adapter: failedAdapter, provider: new DeterministicProvider(), cache, freshRetrievalDeadlineMs: 50 });
  const first = request('fixture-patient-001', { case_id: 'complete_return_visit', correlation_id: 'stale-failed-refresh' });
  const briefing = await prepareWithContext(svc, first);
  failedAdapter.retrieve = async () => ({ records: [], coverage: [{ group: 'notes', status: 'failed', records: 0, attempts: 3, error_class: 'upstream_unavailable' }] });
  now = 11;
  const second = request('fixture-patient-001', { message: 'What changed?' });
  const followUp = await followUpWithContext(svc, briefing.correlation_id, second);
  assert.equal(followUp.disposition, 'blocked');
  assert.equal(cache.get(briefing.correlation_id).status, 'miss');
});

test('fresh retrieval returns an explicit deadline outcome without patient content', async () => {
  let now = 0;
  const cache = new PreparationCache({ ttlMs: 10, now: () => now });
  const slowAdapter = Object.create(adapter);
  slowAdapter.retrieve = async (item) => { await new Promise((resolve) => setTimeout(resolve, 25)); return adapter.retrieve(item); };
  const sink = new InMemoryTraceSink();
  const svc = new AgentForgeService({ adapter: slowAdapter, provider: new DeterministicProvider(), traceSink: sink, cache, freshRetrievalDeadlineMs: 5 });
  const first = request('fixture-patient-001', { case_id: 'complete_return_visit' });
  const briefing = await prepareWithContext(svc, first);
  now = 11;
  const second = request('fixture-patient-001', { message: 'What changed?' });
  const followUp = await followUpWithContext(svc, briefing.correlation_id, second);
  assert.equal(followUp.disposition, 'deadline-exceeded');
  assert.equal(followUp.patient, null);
  assert.equal(followUp.deadline.outcome, 'deadline-exceeded');
  assert.equal(sink.list().some((trace) => trace.deadlineOutcome === 'deadline-exceeded'), true);
});
