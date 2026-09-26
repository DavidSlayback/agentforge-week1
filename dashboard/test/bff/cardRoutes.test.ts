import { describe, expect, it } from 'vitest';
import { buildTestApp, FakeOpenEmr, makeIdTokenSigner, PATIENT, readFixtureFile, routeFixture, signIn } from '../support/harness.ts';

const api = (path: string) => `http://openemr/apis/default/api${path}`;

/** A signed-in test app whose fake OpenEMR serves one shaped patient's routes. */
async function signedIn(): Promise<{ app: Awaited<ReturnType<typeof buildTestApp>>; fake: FakeOpenEmr; cookie: string }> {
  const fake = new FakeOpenEmr();
  const signer = await makeIdTokenSigner();
  const app = await buildTestApp({ fake });
  const { sessionCookie } = await signIn(app, fake, signer);
  return { app, fake, cookie: sessionCookie };
}

function serveAllergies(fake: FakeOpenEmr, id: string, file: string): void {
  fake
    .on('GET', api(`/patient/${id}`), routeFixture(file, 'rest.patient.read'))
    .on('GET', api(`/patient/${id}/allergy`), routeFixture(file, 'rest.allergy.list'))
    .on('GET', api('/list/severity_ccda'), routeFixture('shaped/list-severity-ccda.json', 'rest.list.read'));
}

describe('card routes over HTTP (fastify.inject)', () => {
  it('GET /bff/patients/:puuid/allergies returns the CardResult for that patient', async () => {
    const { app, fake, cookie } = await signedIn();
    serveAllergies(fake, PATIENT.dashSyn01, 'shaped/dash-syn-01.json');
    const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.dashSyn01}/allergies`, cookies: { dashboard_sid: cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.json()).toMatchObject({ kind: 'ok', patientId: PATIENT.dashSyn01, rows: [{ severityLabel: 'Severe', severe: true }] });
  });

  it('empty is a 200 with kind "empty"', async () => {
    const { app, fake, cookie } = await signedIn();
    serveAllergies(fake, PATIENT.p3, 'shaped/patient-3.json');
    const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p3}/allergies`, cookies: { dashboard_sid: cookie } });
    expect(res.json()).toEqual({ kind: 'empty', patientId: PATIENT.p3 });
  });

  it('Medical Problems: a 403 on its route is forbidden for that card only; Allergies still loads', async () => {
    const { app, fake, cookie } = await signedIn();
    serveAllergies(fake, PATIENT.p13, 'shaped/patient-13.json');
    fake.on('GET', api(`/patient/${PATIENT.p13}/medical_problem`), { status: 403, body: { error: 'forbidden' } });
    const problems = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p13}/problems`, cookies: { dashboard_sid: cookie } });
    expect(problems.statusCode).toBe(200);
    expect(problems.json()).toEqual({ kind: 'forbidden', patientId: PATIENT.p13 });
    const allergies = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p13}/allergies`, cookies: { dashboard_sid: cookie } });
    expect(allergies.json()).toMatchObject({ kind: 'ok' });
  });

  it('Medical Problems: pid 13 sends 13 rows to the browser, not 39', async () => {
    const { app, fake, cookie } = await signedIn();
    fake
      .on('GET', api(`/patient/${PATIENT.p13}`), routeFixture('shaped/patient-13.json', 'rest.patient.read'))
      .on('GET', api(`/patient/${PATIENT.p13}/medical_problem`), routeFixture('shaped/patient-13.json', 'rest.problem.list'));
    const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p13}/problems`, cookies: { dashboard_sid: cookie } });
    const body = res.json<{ kind: string; rows: unknown[] }>();
    expect(body.kind).toBe('ok');
    expect(body.rows).toHaveLength(13);
  });

  it('Medications: the upstream 404 with an empty body reaches the browser as "empty", never as an error', async () => {
    const { app, fake, cookie } = await signedIn();
    fake
      .on('GET', api(`/patient/${PATIENT.p3}`), routeFixture('shaped/patient-3.json', 'rest.patient.read'))
      .on('GET', api('/patient/3/medication'), routeFixture('shaped/patient-3.json', 'rest.medication.list'));
    const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p3}/medications`, cookies: { dashboard_sid: cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ kind: 'empty', patientId: PATIENT.p3 });
  });

  it('Prescriptions: DASH-SYN-01 reaches the browser with all 3 rows and the refills gap, and no refills value', async () => {
    const { app, fake, cookie } = await signedIn();
    fake
      .on('GET', api(`/patient/${PATIENT.dashSyn01}`), routeFixture('shaped/dash-syn-01.json', 'rest.patient.read'))
      .on('GET', api('/prescription?patient_id=14&source_table=prescriptions'), routeFixture('shaped/dash-syn-01.json', 'rest.prescription.search'));
    const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.dashSyn01}/prescriptions`, cookies: { dashboard_sid: cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ kind: string; rows: { refills: unknown }[]; notes: { field: string }[] }>();
    expect(body.kind).toBe('ok');
    expect(body.rows).toHaveLength(3);
    expect(body.rows.every((r) => r.refills === null)).toBe(true);
    expect(body.notes.map((n) => n.field)).toEqual(['refills', 'form']);
    expect(fake.unexpected).toEqual([]);
  });

  it('Prescriptions: a browser-supplied query key is refused at the BFF (400) and nothing is sent upstream (M-1)', async () => {
    const { app, fake, cookie } = await signedIn();
    const before = fake.calls.length;
    for (const qs of ['patient_id=15', 'source_table=lists', 'drug=x', "1%3D1)%20OR%20(1=1"]) {
      const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.dashSyn01}/prescriptions?${qs}`, cookies: { dashboard_sid: cookie } });
      expect(res.statusCode, qs).toBe(400);
    }
    expect(fake.calls.length).toBe(before);
  });

  it('Care Team: pid 13 reaches the browser as one team with 3 members and the status/note gaps; pid 3 is empty', async () => {
    const { app, fake, cookie } = await signedIn();
    const file = 'shaped/patient-13.json';
    fake
      .on('GET', api(`/patient/${PATIENT.p13}`), routeFixture(file, 'rest.patient.read'))
      .on('GET', `http://openemr/apis/default/fhir/CareTeam?patient=${PATIENT.p13}`, routeFixture(file, 'fhir.careteam.search'));
    for (const key of Object.keys(readFixtureFile(file))) {
      const [route, ref] = key.split(':');
      if (route === 'fhir.practitioner.read') fake.on('GET', `http://openemr/apis/default/fhir/Practitioner/${ref ?? ''}`, routeFixture(file, key));
      if (route === 'fhir.organization.read') fake.on('GET', `http://openemr/apis/default/fhir/Organization/${ref ?? ''}`, routeFixture(file, key));
    }
    const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p13}/care-team`, cookies: { dashboard_sid: cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ kind: string; rows: { members: unknown[] }[]; notes: { field: string }[] }>();
    expect(body.kind).toBe('ok');
    expect(body.rows[0]?.members).toHaveLength(3);
    expect(body.notes.map((n) => n.field)).toEqual(['member-status', 'note', 'names']);
    expect(fake.unexpected).toEqual([]);

    fake
      .on('GET', api(`/patient/${PATIENT.p3}`), routeFixture('shaped/patient-3.json', 'rest.patient.read'))
      .on('GET', `http://openemr/apis/default/fhir/CareTeam?patient=${PATIENT.p3}`, routeFixture('shaped/patient-3.json', 'fhir.careteam.search'));
    const empty = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p3}/care-team`, cookies: { dashboard_sid: cookie } });
    expect(empty.json()).toEqual({ kind: 'empty', patientId: PATIENT.p3 });
  });

  it('Vitals: DASH-SYN-01 reaches the browser as the non-deleted set 35 (2026-04-05), not the deleted 2026-05-01 set', async () => {
    const { app, fake, cookie } = await signedIn();
    const file = 'shaped/dash-syn-01.json';
    fake
      .on('GET', api(`/patient/${PATIENT.dashSyn01}`), routeFixture(file, 'rest.patient.read'))
      .on('GET', api(`/patient/${PATIENT.dashSyn01}/encounter`), routeFixture(file, 'rest.encounter.list'))
      .on('GET', api('/patient/14/encounter/370/vital'), routeFixture(file, 'rest.vital.list:370'));
    const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.dashSyn01}/vitals`, cookies: { dashboard_sid: cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'ok', rows: [{ date: '2026-04-05 09:10:00' }] });
    expect(fake.unexpected).toEqual([]);
  });

  it('401 without a session, 400 for a malformed puuid, 400 for any query string', async () => {
    const { app, cookie } = await signedIn();
    expect((await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p13}/allergies` })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/dashboard/bff/patients/13/allergies', cookies: { dashboard_sid: cookie } })).statusCode).toBe(400);
    const withQuery = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p13}/allergies?_sort=title`, cookies: { dashboard_sid: cookie } });
    expect(withQuery.statusCode).toBe(400);
  });

  it('an upstream 401 ends the BFF session (reauth) and later calls are 401', async () => {
    const { app, fake, cookie } = await signedIn();
    fake.on('GET', api(`/patient/${PATIENT.p13}`), { status: 401, body: null });
    const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p13}/allergies`, cookies: { dashboard_sid: cookie } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ kind: 'reauth' });
    const session = await app.inject({ method: 'GET', url: '/dashboard/bff/session', cookies: { dashboard_sid: cookie } });
    expect(session.json()).toEqual({ authenticated: false });
  });
});
