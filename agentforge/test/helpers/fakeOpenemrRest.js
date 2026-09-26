import http from 'node:http';

/**
 * TEST-ONLY fake of the OpenEMR standard REST routes `OpenEMRRestAdapter`
 * reads. It is not OpenEMR. Row shapes follow what OpenEMR returned for the
 * E9 seed (`deploy/vultr/seed/agentforge-live-chart-seed.sql`) on the local
 * dev stack: problems and allergies carry `puuid` and `pid`, medications only
 * `pid`, encounters `puuid`/`pid`/`euuid`, a coded allergy reaction is an
 * object with a readable `reaction_title`, and the document route answers 404
 * without a `path`. Every overbroad route also returns a row of another
 * patient (value `LEAKED ...`), which the adapter must drop.
 */
export const LIVE_PATIENT = '7b3f0c52-1d4e-4c8a-9f21-5a6b7c8d9e01';
export const LIVE_PID = 42;
export const OTHER_PATIENT = '0d9e8f7a-6b5c-4d3e-8f21-0a1b2c3d4e5f';

const PREFIX = '/apis/default/api/patient/';

function bodyFor(pathname) {
  if (pathname === `${PREFIX}${LIVE_PATIENT}`) return { data: { uuid: LIVE_PATIENT, pid: LIVE_PID, fname: 'Test', mname: '', lname: 'Patient One', DOB: '1980-04-12' } };
  if (pathname === `${PREFIX}${LIVE_PATIENT}/encounter`) return { data: [
    { euuid: 'enc-live-1', puuid: LIVE_PATIENT, pid: LIVE_PID, reason: 'hypertension evaluation; lisinopril started', date: '2026-08-13 09:00:00' },
    { euuid: 'enc-live-2', puuid: LIVE_PATIENT, pid: LIVE_PID, reason: 'blood-pressure follow-up', date: '2026-09-10 09:10:00' },
    { euuid: 'enc-leak', puuid: OTHER_PATIENT, pid: 99, reason: 'LEAKED other-patient encounter', date: '2026-09-11 09:00:00' },
  ] };
  if (pathname === `${PREFIX}${LIVE_PATIENT}/medical_problem`) return { data: [
    { uuid: 'prob-live-1', puuid: LIVE_PATIENT, patient_uuid: LIVE_PATIENT, pid: LIVE_PID, patient_id: LIVE_PID, title: 'Hypertension', begdate: '2026-08-13', enddate: null, date: '2026-08-13 09:00:00' },
    { uuid: 'prob-leak', puuid: OTHER_PATIENT, pid: 99, title: 'LEAKED condition', begdate: '2026-01-01', enddate: null, date: '2026-01-01 09:00:00' },
  ] };
  if (pathname === `${PREFIX}${LIVE_PID}/medication`) return { data: [
    { uuid: 'med-live-1', pid: LIVE_PID, title: 'Lisinopril', begdate: '2026-08-13', enddate: '2026-09-10', date: '2026-08-13 09:05:00' },
    { uuid: 'med-live-2', pid: LIVE_PID, title: 'Lisinopril', begdate: '2026-09-10', enddate: null, date: '2026-09-10 09:05:00' },
    { uuid: 'med-leak', pid: 99, title: 'LEAKED medication', begdate: '2026-01-01', enddate: null, date: '2026-01-01 09:00:00' },
  ] };
  if (pathname === `${PREFIX}${LIVE_PATIENT}/allergy`) return { data: [
    { uuid: 'allergy-live-1', puuid: LIVE_PATIENT, patient_uuid: LIVE_PATIENT, pid: LIVE_PID, patient_id: LIVE_PID, title: 'Penicillin', reaction: { 247472004: { code: '247472004', description: 'Hives', code_type: 'SNOMED-CT' } }, reaction_title: 'Hives', date: '2026-08-13 09:02:00' },
    { uuid: 'allergy-leak', puuid: OTHER_PATIENT, pid: 99, title: 'LEAKED allergy', reaction_title: 'LEAKED reaction', date: '2026-01-01 09:00:00' },
  ] };
  if (pathname === '/apis/default/api/patient') return { data: [] };
  return null;
}

/**
 * The OpenEMR 8.0.0 behaviour found on production (E9b): the patient-scoped
 * medical_problem and allergy routes answer 200 `[]` although the patient has
 * rows. `emptyScopedLists` reproduces it; `otherPatientsOnly` returns only
 * another patient's rows on those routes.
 */
function variantBody(pathname, { emptyScopedLists = false, otherPatientsOnly = false } = {}) {
  const body = bodyFor(pathname);
  const scopedList = pathname.endsWith('/medical_problem') || pathname.endsWith('/allergy');
  if (!body || !scopedList) return body;
  if (emptyScopedLists) return { data: [] };
  if (otherPatientsOnly) return { data: body.data.filter((row) => row.puuid === OTHER_PATIENT) };
  return body;
}

/** A `fetch` for `OpenEMRRestAdapter({ fetchImpl })`; records every request. */
export function fakeOpenEMRRestFetch(requests = [], variant = {}) {
  return async (url, options) => {
    requests.push({ url, options });
    const body = options?.headers?.authorization === 'Bearer synthetic-token' ? variantBody(new URL(url).pathname, variant) : undefined;
    if (body === undefined) return { ok: false, status: 401, async json() { return {}; } };
    if (body === null) return { ok: false, status: 404, async json() { return {}; } };
    return { ok: true, status: 200, async json() { return body; } };
  };
}

/** The same routes over HTTP, for a spawned `server.js` (`AGENTFORGE_OPENEMR_BASE_URL`). */
export async function startFakeOpenEMRRest() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, authorization: req.headers.authorization || '' });
    const url = new URL(req.url, 'http://fake-openemr');
    const body = req.headers.authorization === 'Bearer synthetic-token' ? bodyFor(url.pathname) : undefined;
    const status = body === undefined ? 401 : body === null ? 404 : 200;
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body || {}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise((resolve) => server.close(resolve)) };
}
