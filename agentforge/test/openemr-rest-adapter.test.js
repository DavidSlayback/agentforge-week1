import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { OpenEMRRefreshTokenProvider, OpenEMRRestAdapter, tokenUrlIssue } from '../src/openemrAdapter.js';
import { clinicalFact, clinicalLabel } from '../src/clinicalLanguage.js';
import { validateRetrievalResult } from '../src/contracts.js';
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
  const retrieved = await adapter.retrieve(item, { correlationId: 'af-correlation-test' });
  assert.equal(validateRetrievalResult(retrieved).valid, true, 'undated OpenEMR identity rows remain valid retrieval evidence');
  assert.equal(item.patient.patient_ref, 'patient-uuid');
  assert.equal(item.patient.display_name, 'Synthetic Patient');
  // E9b: an empty allergy list from the patient-scoped route is not a confirmed absence.
  // F-LIVE: notes are not read (no usable OpenEMR 8.0 route) and say so.
  assert.deepEqual(retrieved.coverage.map((group) => group.status), ['success', 'success', 'success', 'success', 'unverified_empty', 'not_requested']);
  assert.equal(retrieved.coverage.find((group) => group.group === 'allergies').error_class, 'openemr_scoped_list_empty');
  assert.deepEqual(retrieved.records.map((record) => record.source_ref), ['openemr-patient-patient-uuid', 'enc-1', 'problem-1', 'med-1', 'med-1']);
  assert.ok(requests.every(({ options }) => options.method === 'GET'));
  assert.ok(requests.filter(({ url }) => url.includes('/apis/default/api/')).every(({ options }) => options.headers.authorization === 'Bearer synthetic-token'));
  assert.ok(requests.filter(({ url }) => url.includes('/apis/default/api/')).some(({ options }) => options.headers['x-correlation-id'] === 'af-correlation-test'));
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

test('F-LIVE notes: never requested from OpenEMR, reported not_requested with the reason, and the briefing is qualified by it', async () => {
  const requests = [];
  const adapter = new OpenEMRRestAdapter({ baseUrl: 'http://openemr', accessToken: 'synthetic-token', fetchImpl: fakeFetch(requests) });
  const retrieved = await adapter.retrieve(await adapter.getCase('patient-uuid'));
  assert.equal(validateRetrievalResult(retrieved).valid, true);
  assert.deepEqual(retrieved.coverage.find((group) => group.group === 'notes'), { group: 'notes', status: 'not_requested', records: 0, attempts: 0, error_class: 'openemr_notes_route_unavailable' });
  assert.equal(requests.some(({ url }) => url.includes('/document')), false, 'the document route (500 on OpenEMR 8.0.0 without a category path) is not called');
  assert.equal(retrieved.records.some((record) => record.field.startsWith('note.')), false);
  // The contract refuses a not_requested group that claims an attempt, and a zero-attempt group of any other status.
  assert.equal(validateRetrievalResult({ ...retrieved, coverage: retrieved.coverage.map((group) => group.group === 'notes' ? { ...group, attempts: 1 } : group) }).valid, false);
  assert.equal(validateRetrievalResult({ ...retrieved, coverage: retrieved.coverage.map((group) => group.group === 'notes' ? { ...group, status: 'empty' } : group) }).valid, false);
});

test('F-LIVE medication dose: a dose field when the row has one, else "dose not available from this OpenEMR route"; free-text comments are an instructions/comment fact, never a dose', async () => {
  const rows = [
    { uuid: 'med-comments', pid: 17, title: 'Lisinopril', begdate: '2026-09-10', enddate: null, comments: '  10 mg daily  ' },
    { uuid: 'med-structured', pid: 17, title: 'Metformin', begdate: '2026-09-10', enddate: null, drug_dosage_instructions: '500 mg twice daily', comments: 'with meals' },
    { uuid: 'med-none', pid: 17, title: 'Atorvastatin', begdate: '2026-09-10', enddate: null, comments: '' },
    { uuid: 'med-null', pid: 17, title: 'Aspirin', begdate: '2026-09-10', enddate: null, comments: null },
  ];
  const adapter = new OpenEMRRestAdapter({
    baseUrl: 'http://openemr',
    accessToken: 'synthetic-token',
    fetchImpl: async (url) => {
      if (url.endsWith('/patient/patient-uuid')) return { ok: true, status: 200, async json() { return { data: [{ uuid: 'patient-uuid', pid: 17, fname: 'Synthetic', lname: 'Patient' }] }; } };
      if (url.endsWith('/patient/17/medication')) return { ok: true, status: 200, async json() { return { data: rows }; } };
      return { ok: false, status: 404, async json() { return {}; } };
    },
  });
  const retrieved = await adapter.retrieve(await adapter.getCase('patient-uuid'));
  assert.equal(validateRetrievalResult(retrieved).valid, true);
  const value = (field) => retrieved.records.find((record) => record.field === field)?.value;
  assert.equal(value('medication.lisinopril.dose'), 'dose not available from this OpenEMR route', 'comments are not a dose');
  assert.equal(value('medication.lisinopril.comment'), '10 mg daily');
  assert.equal(retrieved.records.find((record) => record.field === 'medication.lisinopril.comment').source_ref, 'med-comments', 'the comment cites the OpenEMR row it came from');
  assert.equal(value('medication.metformin.dose'), '500 mg twice daily');
  assert.equal(value('medication.metformin.comment'), 'with meals');
  assert.equal(value('medication.atorvastatin.dose'), 'dose not available from this OpenEMR route');
  assert.equal(value('medication.atorvastatin.comment'), undefined, 'no comment fact for an empty comment');
  assert.equal(value('medication.aspirin.dose'), 'dose not available from this OpenEMR route');
  assert.ok(retrieved.records.filter((record) => record.field.startsWith('medication.')).every((record) => typeof record.value === 'string' && record.value.trim()), 'no blank medication value');
  assert.equal(value('medication.lisinopril.status'), 'active');
  assert.equal(retrieved.coverage.find((group) => group.group === 'medications').records, 10);
  // Wording: the comment is rendered as instructions/comment, the missing dose as unavailable from this route.
  assert.equal(clinicalLabel('medication.lisinopril.comment'), 'lisinopril instructions/comment');
  assert.equal(clinicalFact({ field: 'medication.lisinopril.comment', value: '10 mg daily' }), 'Lisinopril instructions/comment: 10 mg daily');
  assert.equal(clinicalFact({ field: 'medication.lisinopril.dose', value: 'dose not available from this OpenEMR route' }), 'Lisinopril: dose not available from this OpenEMR route');
  assert.equal(clinicalFact({ field: 'medication.lisinopril.dose', value: '10 mg daily' }), 'Lisinopril is recorded at 10 mg daily', 'a real dose keeps the fixture wording');
});

test('F-LIVE token URL: the refresh provider sends the client secret and refresh token over https only', async () => {
  assert.equal(tokenUrlIssue('https://openemr/oauth2/default/token'), null, 'the Compose default (Docker-internal https) is accepted');
  assert.equal(tokenUrlIssue('https://host.example/oauth2/default/token'), null);
  assert.equal(tokenUrlIssue('http://openemr/oauth2/default/token'), 'OPENEMR_TOKEN_URL_NOT_HTTPS');
  assert.equal(tokenUrlIssue('not a url'), 'OPENEMR_TOKEN_URL_INVALID');
  let calls = 0;
  const provider = new OpenEMRRefreshTokenProvider({ tokenUrl: 'http://openemr/oauth2/default/token', clientId: 'c', clientSecret: 's', fetchImpl: async () => { calls += 1; throw new Error('must not be called'); } });
  provider.state = { refresh_token: 'refresh-1', expires_at: 0 };
  await assert.rejects(provider.getAccessToken(), /OPENEMR_TOKEN_URL_NOT_HTTPS/);
  assert.equal(calls, 0, 'nothing was sent');
});
