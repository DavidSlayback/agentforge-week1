import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenEMRRestAdapter } from '../src/openemrAdapter.js';
import { validateRetrievalResult } from '../src/contracts.js';

// The production OpenEMR 8.0.0 shape seen for AgentForge's service grant: the
// patient-scoped problem and allergy routes answer 200 [] although rows exist.
// The pid-keyed allergy route and the unscoped problem list do return them.
const PATIENT = { uuid: 'patient-uuid', pid: 9, fname: 'Test', lname: 'Patient', DOB: '1980-04-12' };

function adapterWith(routes) {
  const requests = [];
  const adapter = new OpenEMRRestAdapter({
    baseUrl: 'http://openemr',
    accessToken: 'synthetic-token',
    fetchImpl: async (url) => {
      requests.push(url.replace('http://openemr/apis/default/api', ''));
      const path = url.replace('http://openemr/apis/default/api', '');
      if (path === '/patient/patient-uuid') return { ok: true, status: 200, async json() { return { data: [PATIENT] }; } };
      if (path in routes) {
        const value = routes[path];
        if (value instanceof Error) return { ok: false, status: 500, async json() { return {}; } };
        return { ok: true, status: 200, async json() { return { data: value }; } };
      }
      if (path.endsWith('/encounter')) return { ok: true, status: 200, async json() { return { data: [{ uuid: 'enc-1', patient_uuid: 'patient-uuid', reason: 'blood-pressure follow-up' }] }; } };
      if (path.endsWith('/medication')) return { ok: true, status: 200, async json() { return { data: [] }; } };
      return { ok: false, status: 404, async json() { return {}; } };
    },
  });
  return { adapter, requests };
}

const coverageOf = (retrieved, group) => retrieved.coverage.find((entry) => entry.group === group);

test('an empty scoped allergy answer falls back to the pid-keyed route and keeps only this patient\'s rows', async () => {
  const { adapter, requests } = adapterWith({
    '/patient/patient-uuid/allergy': [],
    '/patient/9/allergy': [{ uuid: 'a-keep', pid: 9, puuid: 'patient-uuid', title: 'Penicillin', reaction: 'hives' }, { uuid: 'a-leak', pid: 8, puuid: 'other', title: 'Latex' }],
    '/patient/patient-uuid/medical_problem': [{ uuid: 'p-1', pid: 9, puuid: 'patient-uuid', title: 'Hypertension' }],
  });
  const retrieved = await adapter.retrieve(await adapter.getCase('patient-uuid'));
  assert.deepEqual(coverageOf(retrieved, 'allergies'), { group: 'allergies', status: 'success', records: 1, attempts: 2, error_class: null });
  assert.equal(retrieved.records.some((record) => record.source_ref === 'a-leak'), false);
  assert.ok(requests.includes('/patient/9/allergy'));
  // A scoped route that answered needs no fallback.
  assert.deepEqual(coverageOf(retrieved, 'problems'), { group: 'problems', status: 'success', records: 1, attempts: 1, error_class: null });
  assert.equal(requests.includes('/medical_problem'), false);
  assert.deepEqual(validateRetrievalResult(retrieved), { valid: true, issues: [] });
});

test('an empty scoped problem answer falls back to the unscoped list, filtered to this patient', async () => {
  const { adapter } = adapterWith({
    '/patient/patient-uuid/medical_problem': [],
    '/medical_problem': [
      { uuid: 'p-keep', pid: 9, puuid: 'patient-uuid', title: 'Hypertension' },
      { uuid: 'p-leak', pid: 7, puuid: 'dash-syn-01', title: 'Asthma' },
      { uuid: 'p-mixed', pid: 9, puuid: 'someone-else', title: 'Conflicting identity' },
    ],
    '/patient/patient-uuid/allergy': [{ uuid: 'a-1', pid: 9, puuid: 'patient-uuid', title: 'Penicillin' }],
  });
  const retrieved = await adapter.retrieve(await adapter.getCase('patient-uuid'));
  assert.deepEqual(coverageOf(retrieved, 'problems'), { group: 'problems', status: 'success', records: 1, attempts: 2, error_class: null });
  const refs = retrieved.records.map((record) => record.source_ref);
  assert.ok(refs.includes('p-keep'));
  assert.equal(refs.includes('p-leak'), false);
  assert.equal(refs.includes('p-mixed'), false);
});

test('a fallback that finds nothing for this patient, or fails, leaves the group unverified_empty (never "none")', async () => {
  const { adapter } = adapterWith({
    '/patient/patient-uuid/medical_problem': [],
    '/medical_problem': [{ uuid: 'p-leak', pid: 7, puuid: 'dash-syn-01', title: 'Asthma' }],
    '/patient/patient-uuid/allergy': [],
    '/patient/9/allergy': new Error('boom'),
  });
  const retrieved = await adapter.retrieve(await adapter.getCase('patient-uuid'));
  assert.deepEqual(coverageOf(retrieved, 'problems'), { group: 'problems', status: 'unverified_empty', records: 0, attempts: 1, error_class: 'openemr_scoped_list_empty' });
  assert.deepEqual(coverageOf(retrieved, 'allergies'), { group: 'allergies', status: 'unverified_empty', records: 0, attempts: 1, error_class: 'openemr_scoped_list_empty' });
  assert.equal(retrieved.records.some((record) => record.source_ref === 'p-leak'), false);
});
