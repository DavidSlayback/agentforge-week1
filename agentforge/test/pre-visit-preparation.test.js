import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { FixtureAdapter } from '../src/fixtureAdapter.js';
import { DeterministicProvider, ResilientProvider } from '../src/modelProvider.js';
import { PreVisitPreparation } from '../src/preVisitPreparation.js';
import { PreparationCache } from '../src/preparationCache.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';

const adapter = new FixtureAdapter(fileURLToPath(new URL('../../docs/agentforge/fixtures/clinical-cases.json', import.meta.url)));
const request = (patient_uuid, extra = {}) => ({ patient_uuid, clinician_uuid: 'fixture-physician-001', correlation_id: 'preparation-test', ...extra });
const contextFor = (value) => verifySignedContext(issueSignedContext({ patient_uuid: value.patient_uuid, clinician_uuid: value.clinician_uuid, secret: 'test-secret' }), 'test-secret');

test('PreVisitPreparation owns the briefing lifecycle and cache opening', async () => {
  const preparation = new PreVisitPreparation({ adapter, provider: new DeterministicProvider() });
  const value = request('fixture-patient-001', { case_id: 'complete_return_visit' });
  const briefing = await preparation.prepare(value, { verifiedContext: contextFor(value) });

  assert.equal(briefing.disposition, 'complete');
  assert.equal(briefing.verification.status, 'passed');
  const opened = preparation.openPrepared(briefing.correlation_id, value, { verifiedContext: contextFor(value) });
  assert.equal(opened.status, 'ready');
  assert.equal(opened.response.correlation_id, briefing.correlation_id);
});

test('PreVisitPreparation stops before synthesis and cache write when verification fails', async () => {
  let providerCalled = false;
  const invalidCoverageAdapter = Object.create(adapter);
  invalidCoverageAdapter.retrieve = async () => ({ records: [], coverage: [{ group: 'notes', status: 'invalid-status', records: 0, attempts: 1, error_class: 'fixture-error' }] });
  const provider = { name: 'spy', model: 'spy', generate: async () => { providerCalled = true; throw new Error('provider must not be called'); } };
  const cache = new PreparationCache();
  const preparation = new PreVisitPreparation({ adapter: invalidCoverageAdapter, provider, cache });
  const value = request('fixture-patient-001', { correlation_id: 'preparation-verification-stop', case_id: 'complete_return_visit' });

  const result = await preparation.prepare(value, { verifiedContext: contextFor(value) });

  assert.equal(result.disposition, 'blocked');
  assert.equal(result.verification.status, 'blocked');
  assert.equal(providerCalled, false);
  assert.equal(cache.get(value.correlation_id).status, 'miss');
});

// Guards: the per-sentence verifier must accept the service's own caveats. The
// deterministic fallback names the withheld conflicting drug; if the verifier
// only knew the displayed claims, the deployed ResilientProvider would reject
// its own fallback and the briefing would fail.
test('verified fallback still serves every fixture case when the model is unavailable', async () => {
  const unavailable = { name: 'unavailable-model', model: 'probe', async checkReady() { return true; }, async generate() { throw new Error('MODEL_TIMEOUT'); } };
  for (const item of adapter.cases) {
    const preparation = new PreVisitPreparation({ adapter, provider: new ResilientProvider({ primary: unavailable, fallback: new DeterministicProvider(), maxRetries: 0 }) });
    const value = request(item.patient.patient_ref, { case_id: item.id, correlation_id: `fallback-${item.id}` });
    const result = await preparation.prepare(value, { verifiedContext: contextFor(value) });
    assert.equal(result.model.provider, 'deterministic', item.id);
    assert.notEqual(result.disposition, 'blocked', item.id);
  }
});
