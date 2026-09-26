import { describe, expect, it } from 'vitest';
import {
  buildTestApp,
  captureLogger,
  FakeOpenEmr,
  makeIdTokenSigner,
  PATIENT,
  readFixtureFile,
  responseFixture,
  routeFixture,
  signIn,
  SYNTHETIC_ACCESS_TOKEN,
  TEST_ENV,
} from '../support/harness.ts';

/**
 * AGENTS.md §PHI: "Redaction is tested against a real workflow trace, not a
 * hand-built one." This drives the whole BFF flow (sign-in, header for three
 * patients, the clinical cards, MRN lookup, an upstream error, sign-out) through Fastify with the
 * production logger options, then asserts no identifying or secret value from
 * the fixtures appears anywhere in the captured log stream.
 */
describe('log redaction across the full workflow', () => {
  it('logs route templates, statuses and correlation ids, never PHI, ids or credentials', async () => {
    const fake = new FakeOpenEmr();
    const signer = await makeIdTokenSigner();
    const { logger, lines } = captureLogger();
    const app = await buildTestApp({ fake, logger });

    const { sessionCookie, idToken, authorizeUrl } = await signIn(app, fake, signer);
    const files = [
      [PATIENT.p13, 'shaped/patient-13.json'],
      [PATIENT.p3, 'shaped/patient-3.json'],
      [PATIENT.p12, 'shaped/patient-12.json'],
    ] as const;
    for (const [id, file] of files) {
      fake.on('GET', `http://openemr/apis/default/fhir/Patient/${id}`, routeFixture(file, 'fhir.patient.read'));
      fake.on('GET', `http://openemr/apis/default/api/patient/${id}`, routeFixture(file, 'rest.patient.read'));
      const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${id}/header`, cookies: { dashboard_sid: sessionCookie } });
      expect(res.statusCode).toBe(200);
    }
    // Clinical cards (01-02-01 on): the issue-card routes for data-rich patients.
    fake.on('GET', 'http://openemr/apis/default/api/list/severity_ccda', routeFixture('shaped/list-severity-ccda.json', 'rest.list.read'));
    const clinical: string[] = [];
    for (const [id, file] of [
      [PATIENT.p13, 'shaped/patient-13.json'],
      [PATIENT.dashSyn01, 'shaped/dash-syn-01.json'],
    ] as const) {
      fake.on('GET', `http://openemr/apis/default/api/patient/${id}`, routeFixture(file, 'rest.patient.read'));
      const allergies = routeFixture(file, 'rest.allergy.list');
      fake.on('GET', `http://openemr/apis/default/api/patient/${id}/allergy`, allergies);
      for (const row of (allergies.body as { data: { title: string; uuid: string; reaction_title: string | null }[] }).data) {
        clinical.push(row.title, row.uuid);
        if (row.reaction_title) clinical.push(row.reaction_title);
      }
      const problems = routeFixture(file, 'rest.problem.list');
      fake.on('GET', `http://openemr/apis/default/api/patient/${id}/medical_problem`, problems);
      for (const row of (problems.body as { data: { title: string; uuid: string }[] }).data) clinical.push(row.title, row.uuid);
      const medications = routeFixture(file, 'rest.medication.list');
      const pid = (routeFixture(file, 'rest.patient.read').body as { data: { pid: string } }).data.pid;
      fake.on('GET', `http://openemr/apis/default/api/patient/${pid}/medication`, medications);
      for (const row of medications.body as { title: string; uuid: string }[]) clinical.push(row.title, row.uuid);
      // Dosage instructions (01-06-04): DASH-SYN-01 gets the hand-built Bundle, so real instruction text flows through.
      const medicationRequests =
        id === PATIENT.dashSyn01 ? responseFixture('hand-built/fhir-medicationrequest-dosage-dash-syn-01.json') : routeFixture(file, 'fhir.medicationrequest.search');
      fake.on('GET', `http://openemr/apis/default/fhir/MedicationRequest?patient=${id}&intent=plan`, medicationRequests);
      for (const e of (medicationRequests.body as { entry: { resource: { id: string; dosageInstruction?: { text: string }[] } }[] }).entry) {
        clinical.push(e.resource.id, ...(e.resource.dosageInstruction ?? []).map((d) => d.text));
      }
      const prescriptions = routeFixture(file, 'rest.prescription.search');
      fake.on('GET', `http://openemr/apis/default/api/prescription?patient_id=${pid}&source_table=prescriptions`, prescriptions);
      for (const row of (prescriptions.body as { data: { drug: string; uuid: string }[] }).data) clinical.push(row.drug, row.uuid);
      // Care Team: serve the search and every recorded name read; one Practitioner read succeeds with a
      // (synthetic) name, so a resolved member name is also checked against the log.
      fake.on('GET', `http://openemr/apis/default/fhir/CareTeam?patient=${id}`, routeFixture(file, 'fhir.careteam.search'));
      const teams = (routeFixture(file, 'fhir.careteam.search').body as { entry: { resource: { id: string; name: string } }[] }).entry;
      for (const t of teams) clinical.push(t.resource.id, t.resource.name);
      for (const key of Object.keys(readFixtureFile(file))) {
        const [route, ref] = key.split(':');
        if (route === 'fhir.practitioner.read') {
          const named = responseFixture('hand-built/fhir-practitioner-200.json');
          fake.on('GET', `http://openemr/apis/default/fhir/Practitioner/${ref ?? ''}`, { status: 200, body: { ...(named.body as object), id: ref } });
          clinical.push(ref ?? 'x', 'Synthetic');
        }
        if (route === 'fhir.organization.read') {
          fake.on('GET', `http://openemr/apis/default/fhir/Organization/${ref ?? ''}`, routeFixture(file, key));
          clinical.push(ref ?? 'x', 'Great Clinic');
        }
      }
      // Vitals: the encounter list and every recorded per-encounter vitals response.
      fake.on('GET', `http://openemr/apis/default/api/patient/${id}/encounter`, routeFixture(file, 'rest.encounter.list'));
      for (const e of (routeFixture(file, 'rest.encounter.list').body as { data: { euuid: string }[] }).data) clinical.push(e.euuid);
      for (const key of Object.keys(readFixtureFile(file))) {
        const [route, eid] = key.split(':');
        if (route !== 'rest.vital.list' || !eid) continue;
        const vitals = routeFixture(file, key);
        fake.on('GET', `http://openemr/apis/default/api/patient/${pid}/encounter/${eid}/vital`, vitals);
        for (const v of vitals.body as { uuid: string; date: string; note: string | null }[]) clinical.push(v.uuid, v.date, ...(v.note ? [v.note] : []));
      }
      for (const card of ['allergies', 'problems', 'medications', 'prescriptions', 'care-team', 'vitals']) {
        const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${id}/${card}`, cookies: { dashboard_sid: sessionCookie } });
        expect(res.json()).toMatchObject({ kind: 'ok' });
      }
    }
    fake.on(
      'GET',
      'http://openemr/apis/default/fhir/Patient?identifier=DASH-SYN-02',
      routeFixture('shaped/search-identifier-dash-syn-02.json', 'fhir.patient.search'),
    );
    const lookup = await app.inject({ method: 'GET', url: '/dashboard/bff/patients/by-mrn/DASH-SYN-02', cookies: { dashboard_sid: sessionCookie } });
    expect(lookup.json()).toEqual({ kind: 'found', patientId: PATIENT.dashSyn02 });

    // An upstream failure whose body leaks SQL.
    fake.on('GET', `http://openemr/apis/default/fhir/Patient/${PATIENT.dashSyn02}`, responseFixture('hand-built/rest-500-sqlstate.json'));
    await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.dashSyn02}/header`, cookies: { dashboard_sid: sessionCookie } });

    await app.inject({ method: 'POST', url: '/dashboard/logout', headers: { origin: 'http://localhost:8790' }, cookies: { dashboard_sid: sessionCookie } });

    const log = lines.join('');
    expect(lines.length).toBeGreaterThan(10); // the trace is real, not empty

    const forbidden: string[] = [
      SYNTHETIC_ACCESS_TOKEN,
      idToken,
      sessionCookie,
      TEST_ENV.DASHBOARD_OAUTH_CLIENT_SECRET,
      TEST_ENV.DASHBOARD_SESSION_SECRET,
      'synthetic-auth-code',
      authorizeUrl.searchParams.get('state') ?? 'x',
      authorizeUrl.searchParams.get('nonce') ?? 'x',
      'SQLSTATE',
      'LEAKED_SQL_MARKER',
      'DASH-SYN-02',
      ...Object.values(PATIENT),
    ];
    // Every name and DOB in the fixtures.
    for (const [, file] of files) {
      const body = routeFixture(file, 'rest.patient.read').body as { data: { fname: string; lname: string; DOB: string } };
      forbidden.push(body.data.fname, body.data.lname, body.data.DOB);
    }
    forbidden.push(...clinical);
    for (const needle of forbidden) expect(log.includes(needle), `log contains ${needle.slice(0, 12)}…`).toBe(false);

    // What it does log: route templates and upstream route ids.
    expect(log).toContain('/dashboard/bff/patients/:puuid/header');
    expect(log).toContain('"routeId":"fhir.patient.read"');
    expect(log).toContain('"routeId":"oauth.token"');
    expect(log).toContain('/dashboard/bff/patients/:puuid/allergies');
    expect(log).toContain('"routeId":"rest.allergy.list"');
    expect(log).toContain('/dashboard/bff/patients/:puuid/problems');
    expect(log).toContain('"routeId":"rest.problem.list"');
    expect(log).toContain('/dashboard/bff/patients/:puuid/medications');
    expect(log).toContain('"routeId":"rest.medication.list"');
    expect(log).toContain('"routeId":"fhir.medicationrequest.search"');
    expect(log).toContain('/dashboard/bff/patients/:puuid/prescriptions');
    expect(log).toContain('"routeId":"rest.prescription.search"');
    expect(log).toContain('/dashboard/bff/patients/:puuid/care-team');
    expect(log).toContain('"routeId":"fhir.careteam.search"');
    expect(log).toContain('"routeId":"fhir.practitioner.read"');
    expect(log).toContain('"routeId":"fhir.organization.read"');
    expect(log).toContain('/dashboard/bff/patients/:puuid/vitals');
    expect(log).toContain('"routeId":"rest.encounter.list"');
    expect(log).toContain('"routeId":"rest.vital.list"');
  });
});
