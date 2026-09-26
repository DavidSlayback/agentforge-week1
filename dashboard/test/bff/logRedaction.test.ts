import { describe, expect, it } from 'vitest';
import {
  buildTestApp,
  captureLogger,
  FakeOpenEmr,
  makeIdTokenSigner,
  PATIENT,
  responseFixture,
  routeFixture,
  signIn,
  SYNTHETIC_ACCESS_TOKEN,
  TEST_ENV,
} from '../support/harness.ts';

/**
 * AGENTS.md §PHI: "Redaction is tested against a real workflow trace, not a
 * hand-built one." This drives the whole BFF flow (sign-in, header for three
 * patients, MRN lookup, an upstream error, sign-out) through Fastify with the
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
    for (const needle of forbidden) expect(log.includes(needle), `log contains ${needle.slice(0, 12)}…`).toBe(false);

    // What it does log: route templates and upstream route ids.
    expect(log).toContain('/dashboard/bff/patients/:puuid/header');
    expect(log).toContain('"routeId":"fhir.patient.read"');
    expect(log).toContain('"routeId":"oauth.token"');
  });
});
