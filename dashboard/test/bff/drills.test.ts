import { describe, expect, it } from 'vitest';
import { DRILLS, type Drill, type DrillUpstream } from '../support/drills.ts';
import { buildTestApp, FakeOpenEmr, makeIdTokenSigner, PATIENT, responseFixture, routeFixture, signIn, type FixtureResponse } from '../support/harness.ts';

/**
 * Error-state drills through the BFF (arc 01-06-01 "Error-state drills",
 * done in 01-06-04): a signed-in session, a fake OpenEMR serving pid 13's
 * shaped fixtures, and one upstream route broken per drill. The BFF's HTTP
 * answer must be exactly the drill's `wire` value; `test/web/Drills.test.tsx`
 * renders that same value.
 */

const FILE = 'shaped/patient-13.json';
const API = 'http://openemr/apis/default/api';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const URLS: Readonly<Record<DrillUpstream, string>> = {
  'rest.patient.read': `${API}/patient/${PATIENT.p13}`,
  'rest.allergy.list': `${API}/patient/${PATIENT.p13}/allergy`,
  'rest.problem.list': `${API}/patient/${PATIENT.p13}/medical_problem`,
  'rest.medication.list': `${API}/patient/13/medication`,
};

function upstreamResponse(drill: Drill): FixtureResponse {
  return 'fixture' in drill.upstream ? responseFixture(drill.upstream.fixture) : drill.upstream;
}

async function run(drill: Drill) {
  const fake = new FakeOpenEmr();
  const signer = await makeIdTokenSigner();
  const app = await buildTestApp({ fake });
  const { sessionCookie } = await signIn(app, fake, signer);
  for (const route of Object.keys(URLS) as DrillUpstream[]) {
    fake.on('GET', URLS[route], route === drill.breaks ? upstreamResponse(drill) : routeFixture(FILE, route));
  }
  fake.on('GET', `${API}/list/severity_ccda`, routeFixture('shaped/list-severity-ccda.json', 'rest.list.read'));
  fake.on('GET', `http://openemr/apis/default/fhir/MedicationRequest?patient=${PATIENT.p13}&intent=plan`, routeFixture(FILE, 'fhir.medicationrequest.search'));
  const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p13}/${drill.card}`, cookies: { dashboard_sid: sessionCookie } });
  const session = await app.inject({ method: 'GET', url: '/dashboard/bff/session', cookies: { dashboard_sid: sessionCookie } });
  return { res, session, fake };
}

describe('error-state drills through the BFF against a mocked OpenEMR', () => {
  it.each(DRILLS.map((d) => [d.name, d] as const))('%s', async (_name, drill) => {
    const { res, session, fake } = await run(drill);
    expect(fake.calls.map((c) => c.url)).toContain(URLS[drill.breaks]);
    expect(res.statusCode).toBe(drill.wire.status);
    const body = res.json<Record<string, unknown>>();
    const wire = drill.wire;
    switch (wire.kind) {
      case 'reauth':
        expect(body).toEqual({ kind: 'reauth' });
        // A 401 upstream ends the BFF session; the browser must sign in again.
        expect(session.json()).toEqual({ authenticated: false });
        break;
      case 'forbidden':
      case 'empty':
        expect(body).toEqual({ kind: wire.kind, patientId: PATIENT.p13 });
        expect(session.json()).toMatchObject({ authenticated: true });
        break;
      case 'error':
        expect(Object.keys(body).sort()).toEqual(['code', 'correlationId', 'kind', 'patientId']);
        expect(body).toMatchObject({ kind: 'error', patientId: PATIENT.p13, code: wire.code });
        expect(body['correlationId']).toMatch(UUID);
        expect(session.json()).toMatchObject({ authenticated: true });
        break;
    }
    for (const text of drill.neverShown) expect(res.body, text).not.toContain(text);
  });
});
