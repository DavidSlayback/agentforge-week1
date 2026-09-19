import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OpenEMRRefreshTokenProvider, OpenEMRRestAdapter } from '../src/openemrAdapter.js';
import { issueSignedContext, verifySignedContext } from '../src/accessContext.js';

function fakeFetch(requests) {
  return async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/patient?limit=1')) return { ok: true, status: 200, async json() { return { data: [] }; } };
    if (url.endsWith('/patient/patient-uuid')) return { ok: true, status: 200, async json() { return { data: [{ uuid: 'patient-uuid', pid: 17, fname: 'Synthetic', lname: 'Patient', DOB: '1980-04-12' }] }; } };
    if (url.endsWith('/patient/patient-uuid/encounter')) return { ok: true, status: 200, async json() { return { data: [{ uuid: 'enc-1', patient_uuid: 'patient-uuid', reason: 'blood-pressure follow-up', date: '2026-09-10' }] }; } };
    if (url.endsWith('/patient/patient-uuid/medical_problem')) return { ok: true, status: 200, async json() { return { data: [{ uuid: 'problem-1', patient_uuid: 'patient-uuid', title: 'Hypertension', status: 'active' }] }; } };
    if (url.endsWith('/patient/17/medication')) return { ok: true, status: 200, async json() { return { data: [{ uuid: 'med-1', pid: 17, title: 'Lisinopril', status: 'active' }] }; } };
    if (url.endsWith('/patient/patient-uuid/allergy')) return { ok: true, status: 200, async json() { return { data: [] }; } };
    if (url.endsWith('/patient/17/document')) return { ok: true, status: 200, async json() { return { data: [] }; } };
    return { ok: false, status: 404, async json() { return {}; } };
  };
}

test('OpenEMR REST adapter uses only GET allowlisted routes and normalizes records', async () => {
  const requests = [];
  const adapter = new OpenEMRRestAdapter({ baseUrl: 'http://openemr', accessToken: 'synthetic-token', fetchImpl: fakeFetch(requests) });
  assert.equal(await adapter.checkReady(), true);
  const item = await adapter.getCase('patient-uuid');
  const retrieved = await adapter.retrieve(item);
  assert.equal(item.patient.patient_ref, 'patient-uuid');
  assert.equal(item.patient.display_name, 'Synthetic Patient');
  assert.deepEqual(retrieved.coverage.map((group) => group.status), ['success', 'success', 'success', 'success', 'empty', 'empty']);
  assert.deepEqual(retrieved.records.map((record) => record.source_ref), ['openemr-patient-patient-uuid', 'enc-1', 'problem-1', 'med-1']);
  assert.ok(requests.every(({ options }) => options.method === 'GET'));
  assert.ok(requests.filter(({ url }) => url.includes('/apis/default/api/')).every(({ options }) => options.headers.authorization === 'Bearer synthetic-token'));
});

test('OpenEMR REST adapter fails closed without an access token', async () => {
  const adapter = new OpenEMRRestAdapter({ baseUrl: 'http://openemr', fetchImpl: async () => { throw new Error('unexpected network call'); } });
  assert.equal(await adapter.checkReady(), false);
});

test('OpenEMR REST adapter requires the OpenEMR session issuer by default', () => {
  const adapter = new OpenEMRRestAdapter({ baseUrl: 'http://openemr', accessToken: 'synthetic-token' });
  const token = issueSignedContext({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001', secret: 'synthetic-secret' });
  const context = verifySignedContext(token, 'synthetic-secret');
  const result = adapter.authorize({ patient_uuid: 'fixture-patient-001', clinician_uuid: 'fixture-physician-001' }, context);
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'server_context_issuer_invalid');
});

test('OpenEMR REST adapter filters overbroad patient-history responses by patient identity', async () => {
  const adapter = new OpenEMRRestAdapter({
    baseUrl: 'http://openemr',
    accessToken: 'synthetic-token',
    fetchImpl: async (url) => {
      if (url.endsWith('/patient/patient-uuid')) return { ok: true, status: 200, async json() { return { data: [{ uuid: 'patient-uuid', pid: 17, fname: 'Synthetic', lname: 'Patient' }] }; } };
      if (url.endsWith('/medical_problem')) return { ok: true, status: 200, async json() { return { data: [{ uuid: 'keep', patient_uuid: 'patient-uuid', title: 'Keep' }, { uuid: 'leak', patient_uuid: 'other-patient', title: 'Do not include' }, { uuid: 'conflicting-pid', patient_uuid: 'patient-uuid', pid: 18, title: 'Do not include' }] }; } };
      if (url.endsWith('/allergy')) return { ok: true, status: 200, async json() { return { data: [{ uuid: 'allergy-keep', pid: 17, title: 'Keep' }, { uuid: 'allergy-leak', pid: 18, title: 'Do not include' }] }; } };
      if (url.endsWith('/encounter')) return { ok: true, status: 200, async json() { return { data: [{ uuid: 'enc-keep', patient_uuid: 'patient-uuid', reason: 'Keep' }, { uuid: 'enc-no-identity', reason: 'Do not include' }] }; } };
      if (url.endsWith('/medication')) return { ok: true, status: 200, async json() { return { data: [] }; } };
      if (url.endsWith('/document')) return { ok: true, status: 200, async json() { return { data: [] }; } };
      return { ok: false, status: 404, async json() { return {}; } };
    },
  });
  const retrieved = await adapter.retrieve(await adapter.getCase('patient-uuid'));
  assert.deepEqual(retrieved.records.map((record) => record.source_ref), ['openemr-patient-patient-uuid', 'enc-keep', 'keep', 'allergy-keep']);
  assert.equal(retrieved.records.some((record) => record.source_ref === 'conflicting-pid'), false);
  assert.equal(retrieved.coverage.find((group) => group.group === 'problems').records, 1);
  assert.equal(retrieved.coverage.find((group) => group.group === 'allergies').records, 1);
  assert.equal(retrieved.coverage.find((group) => group.group === 'encounters').records, 1);
  assert.equal(retrieved.records.some((record) => record.source_ref === 'enc-no-identity'), false);
});

test('OpenEMR REST adapter rejects a patient endpoint response for another patient', async () => {
  const adapter = new OpenEMRRestAdapter({
    baseUrl: 'http://openemr',
    accessToken: 'synthetic-token',
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { data: [{ uuid: 'other-patient', pid: 18 }] }; } }),
  });
  await assert.rejects(() => adapter.getCase('patient-uuid'), /PATIENT_SCOPE_MISMATCH/);
});

test('OpenEMR REST adapter rejects a patient endpoint response without identity proof', async () => {
  const adapter = new OpenEMRRestAdapter({
    baseUrl: 'http://openemr',
    accessToken: 'synthetic-token',
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { data: [{ fname: 'Other', lname: 'Synthetic' }] }; } }),
  });
  await assert.rejects(() => adapter.getCase('patient-uuid'), /PATIENT_SCOPE_MISMATCH/);
});

test('OpenEMR refresh provider rotates and persists refresh tokens without exposing them to callers', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'agentforge-openemr-token-'));
  const cachePath = path.join(tempDir, 'token.json');
  await writeFile(cachePath, JSON.stringify({ access_token: 'expired', refresh_token: 'refresh-1', expires_at: 0 }), { mode: 0o600 });
  const provider = new OpenEMRRefreshTokenProvider({
    tokenUrl: 'https://openemr/oauth2/default/token',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    cachePath,
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, 'POST');
      assert.match(options.body, /grant_type=refresh_token/);
      assert.match(options.body, /refresh_token=refresh-1/);
      return { ok: true, status: 200, async json() { return { access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 3600 }; } };
    },
  });
  try {
    assert.equal(await provider.getAccessToken(), 'access-2');
    const persisted = JSON.parse(await readFile(cachePath, 'utf8'));
    assert.equal(persisted.refresh_token, 'refresh-2');
    assert.equal(await provider.getAccessToken(), 'access-2');
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
