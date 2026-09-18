import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { DeterministicProvider } from '../src/modelProvider.js';
import { AgentForgeService } from '../src/service.js';
import { PreparationCache } from '../src/preparationCache.js';
import { InMemoryTraceSink } from '../../observability/index.js';

const adapter = new FixtureAdapter(fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url)));
const make = () => new AgentForgeService({ adapter, provider: new DeterministicProvider() });
const request = (patient_uuid, extra = {}) => ({ patient_uuid, clinician_uuid: 'fixture-physician-001', authorization: { status: 'authorized', scope: 'read-briefing' }, correlation_id: 'test-correlation', ...extra });

test('prepares a grounded complete briefing', async () => { const result = await make().prepare(request('fixture-patient-001', { case_id: 'complete_return_visit' })); assert.equal(result.disposition, 'complete'); assert.equal(result.verification.status, 'passed'); assert.ok(result.claims.every((claim) => claim.evidence.length)); });
test('blocks missing authorization without patient data', async () => { const result = await make().prepare({ patient_uuid: 'fixture-patient-001', clinician_uuid: '', authorization: { status: 'denied' } }); assert.equal(result.disposition, 'blocked'); assert.equal(result.patient, null); });
test('qualifies partial retrieval and withholds dependent claims', async () => { const result = await make().prepare(request('fixture-patient-006', { case_id: 'partial_retrieval' })); assert.equal(result.disposition, 'partial'); assert.equal(result.qualification.required, true); assert.deepEqual(result.withheld_fields, ['encounter_summary', 'note_summary']); });
test('isolates follow-up conversations by patient', async () => { const svc = make(); await svc.prepare(request('fixture-patient-001', { case_id: 'complete_return_visit' })); const result = await svc.followUp('test-correlation', request('fixture-patient-006', { message: 'What changed?' })); assert.equal(result.disposition, 'blocked'); });
test('records the request lifecycle with verification and display outcomes', async () => { const sink = new InMemoryTraceSink(); const svc = new AgentForgeService({ adapter, provider: new DeterministicProvider(), traceSink: sink }); await svc.prepare(request('fixture-patient-001', { case_id: 'complete_return_visit' })); const trace = sink.list()[0]; assert.deepEqual(trace.stages.map((stage) => stage.name), ['authorization', 'retrieval', 'verification', 'model', 'display']); assert.equal(trace.verification.status, 'passed'); assert.equal(trace.display.status, 'displayed'); });

test('uses a server-owned preparation cache and records interaction latency', async () => {
  const sink = new InMemoryTraceSink();
  const cache = new PreparationCache({ ttlMs: 100, now: () => 0 });
  const svc = new AgentForgeService({ adapter, provider: new DeterministicProvider(), traceSink: sink, cache });
  const briefing = await svc.prepare(request('fixture-patient-001', { case_id: 'complete_return_visit' }));
  const followUp = await svc.followUp(briefing.correlation_id, request('fixture-patient-001', { message: 'What changed?' }));
  assert.equal(followUp.disposition, 'complete');
  const traces = sink.list();
  assert.equal(traces[0].interactionType, 'briefing');
  assert.equal(traces[0].cache.status, 'stored');
  assert.equal(typeof traces[0].latencyMs.synthesis, 'number');
  assert.equal(traces[1].interactionType, 'cache_followup');
  assert.equal(traces[1].cache.status, 'hit');
  assert.equal(sink.snapshot().latencyByInteraction.cache_followup.p95, traces[1].durationMs);
});

test('stale preparation cache refreshes through a bounded fresh retrieval', async () => {
  let now = 0;
  const cache = new PreparationCache({ ttlMs: 10, now: () => now });
  const sink = new InMemoryTraceSink();
  const svc = new AgentForgeService({ adapter, provider: new DeterministicProvider(), traceSink: sink, cache, freshRetrievalDeadlineMs: 50 });
  const briefing = await svc.prepare(request('fixture-patient-001', { case_id: 'complete_return_visit' }));
  now = 11;
  const followUp = await svc.followUp(briefing.correlation_id, request('fixture-patient-001', { message: 'What changed?' }));
  assert.equal(followUp.disposition, 'complete');
  assert.equal(sink.snapshot().cacheOutcomes.stale, 1);
  assert.equal(sink.list().some((trace) => trace.interactionType === 'fresh_followup' && trace.deadlineOutcome === 'within_deadline'), true);
});

test('fresh retrieval returns an explicit deadline outcome without patient content', async () => {
  let now = 0;
  const cache = new PreparationCache({ ttlMs: 10, now: () => now });
  const slowAdapter = Object.create(adapter);
  slowAdapter.retrieve = async (item) => { await new Promise((resolve) => setTimeout(resolve, 25)); return adapter.retrieve(item); };
  const sink = new InMemoryTraceSink();
  const svc = new AgentForgeService({ adapter: slowAdapter, provider: new DeterministicProvider(), traceSink: sink, cache, freshRetrievalDeadlineMs: 5 });
  const briefing = await svc.prepare(request('fixture-patient-001', { case_id: 'complete_return_visit' }));
  now = 11;
  const followUp = await svc.followUp(briefing.correlation_id, request('fixture-patient-001', { message: 'What changed?' }));
  assert.equal(followUp.disposition, 'deadline-exceeded');
  assert.equal(followUp.patient, null);
  assert.equal(followUp.deadline.outcome, 'deadline-exceeded');
  assert.equal(sink.list().some((trace) => trace.deadlineOutcome === 'deadline-exceeded'), true);
});
