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
test('answers follow-up topics from the patient-scoped evidence boundary', async () => {
  const svc = make();
  const first = request('fixture-patient-001', { case_id: 'complete_return_visit' });
  const briefing = await prepareWithContext(svc, first);
  const result = await followUpWithContext(svc, briefing.correlation_id, request('fixture-patient-001', { message: 'What changed since the last visit?' }));
  assert.match(result.text, /changed from 5 mg daily .* to 10 mg daily/i);
  assert.equal(result.claims.length, briefing.claims.length);
  let capturedPrompt;
  svc.conversationProvider = { name: 'live-test', generate: async ({ prompt }) => {
    capturedPrompt = prompt;
    return { text: 'The current record is dated 2026-09-10: medication.lisinopril.dose=10 mg daily.' };
  } };
  await followUpWithContext(svc, briefing.correlation_id, request('fixture-patient-001', { message: 'What date was that recorded?' }));
  assert.ok(capturedPrompt.includes(JSON.stringify(briefing.text)), 'the conversation receives the prepared synthesis');
  assert.ok(capturedPrompt.includes('What changed since the last visit?'), 'the conversation retains the previous question');
  assert.ok(capturedPrompt.includes(result.text), 'the conversation retains the previous answer');
  assert.ok(capturedPrompt.includes('2026-09-10'), 'the conversation receives source dates');
  assert.equal(svc.cache.get(briefing.correlation_id).entry.history.length, 2);
  svc.openPrepared(briefing.correlation_id, first, { verifiedContext: contextFor(first), resetConversation: true });
  assert.deepEqual(svc.cache.get(briefing.correlation_id).entry.history, []);
});
test('answers documented plan follow-through without inventing completion', async () => { const svc = make(); const first = request('fixture-patient-001', { case_id: 'complete_return_visit' }); const briefing = await prepareWithContext(svc, first); const result = await followUpWithContext(svc, briefing.correlation_id, request('fixture-patient-001', { message: 'What plan items need follow-through?' })); assert.match(result.text, /plan follow-through/i); assert.match(result.text, /home blood-pressure log reviewed/i); });
test('does not invent a discrepancy when the verified evidence has none', async () => { const svc = make(); const first = request('fixture-patient-001', { case_id: 'complete_return_visit' }); const briefing = await prepareWithContext(svc, first); const result = await followUpWithContext(svc, briefing.correlation_id, request('fixture-patient-001', { message: 'Which records conflict?' })); assert.match(result.text, /no explicit conflicting records/i); });
test('withholds same-date conflicts and explains them in follow-up', async () => { const svc = make(); const briefing = await prepareWithContext(svc, request('fixture-patient-002', { case_id: 'conflicting_latest_values' })); assert.equal(briefing.disposition, 'qualified'); assert.equal(briefing.claims.some((claim) => claim.field === 'medication.metformin.dose'), false); assert.ok(briefing.qualification.reasons.includes('conflict:medication.metformin.dose')); const result = await followUpWithContext(svc, briefing.correlation_id, request('fixture-patient-002', { message: 'Which records conflict?' })); assert.match(result.text, /conflicting records remain unresolved/i); assert.match(result.text, /metformin/i); });
test('does not treat same-timestamp values as a resolved change', async () => {
  const conflictingAdapter = Object.create(adapter);
  conflictingAdapter.getCase = (patientRef, caseId) => {
    const item = adapter.getCase(patientRef, caseId);
    return { ...item, expected: { ...item.expected, withhold_fields: [] }, records: [...item.records,
      { field: 'medication.lisinopril.dose', value: '20 mg daily', recorded_at: '2026-09-11T09:00:00Z', author: 'fixture-clinician-a', source_ref: 'med-tie-a', reassessment_documented: true },
      { field: 'medication.lisinopril.dose', value: '30 mg daily', recorded_at: '2026-09-11T09:00:00Z', author: 'fixture-clinician-b', source_ref: 'med-tie-b', reassessment_documented: true },
    ] };
  };
  const result = await prepareWithContext(new AgentForgeService({ adapter: conflictingAdapter, provider: new DeterministicProvider() }), request('fixture-patient-001', { case_id: 'complete_return_visit' }));
  assert.equal(result.disposition, 'qualified');
  assert.equal(result.claims.some((claim) => claim.field === 'medication.lisinopril.dose'), false);
  assert.equal(result.comparison.changes.some((change) => change.field === 'medication.lisinopril.dose' && change.current.value === '30 mg daily'), false);
});
test('blocks external providers by default for live OpenEMR adapters', async () => {
  const liveAdapter = { name: 'openemr-rest', authorize: () => ({ status: 'authorized', patient_uuid: 'patient-uuid', clinician_uuid: 'clinician-uuid' }) };
  const provider = { name: 'external-provider', generate: async () => { throw new Error('provider must not be called'); } };
  const result = await new AgentForgeService({ adapter: liveAdapter, provider }).prepare(request('patient-uuid'));
  assert.equal(result.disposition, 'blocked');
  assert.equal(result.qualification.reasons[0], 'live_external_provider_not_approved');
});
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

test('fresh retrieval deadline includes patient lookup', async () => {
  let now = 0;
  const slowAdapter = Object.create(adapter);
  slowAdapter.getCase = async (...args) => { await new Promise((resolve) => setTimeout(resolve, 25)); return adapter.getCase(...args); };
  const svc = new AgentForgeService({ adapter: slowAdapter, provider: new DeterministicProvider(), cache: new PreparationCache({ ttlMs: 10, now: () => now }), freshRetrievalDeadlineMs: 5 });
  const first = request('fixture-patient-001', { case_id: 'complete_return_visit' });
  const briefing = await prepareWithContext(svc, first);
  now = 11;
  const result = await followUpWithContext(svc, briefing.correlation_id, request('fixture-patient-001', { message: 'What changed?' }));
  assert.equal(result.disposition, 'deadline-exceeded');
  assert.equal(result.patient, null);
});

test('calendar prewarm prepares once and opens a bound cache hit', async () => {
  let now = 0;
  let modelCalls = 0;
  const provider = new DeterministicProvider();
  const generate = provider.generate.bind(provider);
  provider.generate = (...args) => { modelCalls += 1; return generate(...args); };
  const sink = new InMemoryTraceSink();
  const svc = new AgentForgeService({ adapter, provider, traceSink: sink, cache: new PreparationCache({ ttlMs: 100, now: () => now }) });
  const value = request('fixture-patient-001', { case_id: 'complete_return_visit' });
  const accepted = svc.prewarm(value, { verifiedContext: contextFor(value), scheduleRevision: 'visit-2026-09-21-0900', sourceRevision: 'complete_return_visit' });
  assert.equal(accepted.status, 'accepted');
  const duplicate = svc.prewarm(value, { verifiedContext: contextFor(value), scheduleRevision: 'visit-2026-09-21-0900', sourceRevision: 'complete_return_visit' });
  assert.equal(duplicate.duplicate, true);
  await accepted.promise;
  const opened = svc.openPrepared(accepted.correlation_id, value, { verifiedContext: contextFor(value) });
  assert.equal(opened.status, 'ready');
  assert.equal(opened.cache.scheduleRevision, 'visit-2026-09-21-0900');
  const reopenRequest = { patient_uuid: value.patient_uuid, clinician_uuid: value.clinician_uuid };
  const reopened = await prepareWithContext(svc, reopenRequest, { reusePrepared: true, scheduleRevision: 'visit-2026-09-21-0900' });
  assert.equal(reopened.correlation_id, opened.response.correlation_id);
  assert.equal(modelCalls, 1, 'opening a prepared briefing must not synthesize again');
  assert.equal(sink.list().at(-1).interactionType, 'prepared_open');
  const mismatch = svc.openPrepared(accepted.correlation_id, request('fixture-patient-006'), { verifiedContext: contextFor(request('fixture-patient-006')) });
  assert.equal(mismatch.status, 'not_ready');
  const denied = await svc.prepare(reopenRequest, { reusePrepared: true, scheduleRevision: 'visit-2026-09-21-0900' });
  assert.equal(denied.disposition, 'blocked');
  now = 101;
  assert.equal(svc.openPrepared(accepted.correlation_id, value, { verifiedContext: contextFor(value) }).status, 'not_ready');
  await prepareWithContext(svc, reopenRequest, { reusePrepared: true, scheduleRevision: 'visit-2026-09-21-0900' });
  assert.equal(modelCalls, 2, 'expired preparation must be rebuilt');
});

test('calendar prewarm fails closed for mismatched authorization and provider failure', async () => {
  const value = request('fixture-patient-001', { case_id: 'complete_return_visit' });
  const mismatch = make().prewarm(value, { verifiedContext: contextFor(request('fixture-patient-002')) });
  assert.equal(mismatch.status, 'blocked');
  const failing = new AgentForgeService({ adapter, provider: { generate: async () => { throw new Error('MODEL_DOWN'); } } });
  const accepted = failing.prewarm(value, { verifiedContext: contextFor(value), scheduleRevision: 'visit-failing' });
  await assert.rejects(accepted.promise, /MODEL_DOWN/);
  assert.equal(failing.cache.get(accepted.correlation_id).status, 'miss');
});
