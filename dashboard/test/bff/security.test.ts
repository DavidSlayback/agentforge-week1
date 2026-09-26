import { describe, expect, it } from 'vitest';
import {
  buildTestApp,
  FakeOpenEmr,
  makeIdTokenSigner,
  makeStaticDir,
  PATIENT,
  routeFixture,
  signIn,
  SYNTHETIC_ACCESS_TOKEN,
  TEST_ENV,
  testConfig,
} from '../support/harness.ts';

const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/;

async function signedInApp(configOverrides: Record<string, string> = {}) {
  const fake = new FakeOpenEmr();
  const signer = await makeIdTokenSigner();
  const app = await buildTestApp({ fake, config: testConfig(configOverrides, makeStaticDir()) });
  const { sessionCookie } = await signIn(app, fake, signer);
  for (const [id, file] of [
    [PATIENT.p13, 'shaped/patient-13.json'],
    [PATIENT.p12, 'shaped/patient-12.json'],
  ] as const) {
    fake.on('GET', `http://openemr/apis/default/fhir/Patient/${id}`, routeFixture(file, 'fhir.patient.read'));
    fake.on('GET', `http://openemr/apis/default/api/patient/${id}`, routeFixture(file, 'rest.patient.read'));
  }
  return { app, fake, sessionCookie };
}

describe('security headers and caching', () => {
  it('sends CSP, no-referrer and nosniff everywhere, and no-store on /bff, /login, /callback, /logout', async () => {
    const { app, sessionCookie } = await signedInApp();
    const spa = await app.inject({ method: 'GET', url: '/dashboard/' });
    expect(spa.statusCode).toBe(200);
    expect(spa.headers['content-security-policy']).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://openemr.test",
    );
    expect(spa.headers['referrer-policy']).toBe('no-referrer');
    expect(spa.headers['x-content-type-options']).toBe('nosniff');
    for (const url of [`/dashboard/bff/patients/${PATIENT.p13}/header`, '/dashboard/bff/session', '/dashboard/login']) {
      const res = await app.inject({ method: 'GET', url, cookies: { dashboard_sid: sessionCookie } });
      expect(res.headers['cache-control'], url).toBe('no-store');
      expect(res.headers['content-security-policy'], url).toBeDefined();
    }
  });

  it('form-action is plain self when OpenEMR shares the public origin (production shape)', async () => {
    const app = await buildTestApp({
      fake: new FakeOpenEmr(),
      config: testConfig({ DASHBOARD_PUBLIC_ORIGIN: 'https://host.test', DASHBOARD_OAUTH_ISSUER: 'https://host.test/oauth2/default', NODE_ENV: 'production' }),
    });
    const res = await app.inject({ method: 'GET', url: '/dashboard/health' });
    expect(res.headers['content-security-policy']).toContain("form-action 'self'");
    expect(res.headers['content-security-policy']).not.toContain('https://host.test');
  });

  it('serves the SPA for deep links and redirects /dashboard to /dashboard/', async () => {
    const { app } = await signedInApp();
    const deep = await app.inject({ method: 'GET', url: `/dashboard/patients/${PATIENT.p13}` });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain('<div id="root">');
    const bare = await app.inject({ method: 'GET', url: '/dashboard' });
    expect(bare.statusCode).toBe(308);
    expect(bare.headers.location).toBe('/dashboard/');
    const unknownBff = await app.inject({ method: 'GET', url: '/dashboard/bff/nope' });
    expect(unknownBff.statusCode).toBe(404);
  });
});

describe('/bff request hygiene', () => {
  it('returns 401 without a session', async () => {
    const app = await buildTestApp({ fake: new FakeOpenEmr() });
    const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p13}/header` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ kind: 'reauth' });
    const s = await app.inject({ method: 'GET', url: '/dashboard/bff/session' });
    expect(s.json()).toEqual({ authenticated: false });
  });

  it('rejects any query string with 400 and never forwards it', async () => {
    const { app, fake, sessionCookie } = await signedInApp();
    const before = fake.calls.length;
    const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p13}/header?_sort=x`, cookies: { dashboard_sid: sessionCookie } });
    expect(res.statusCode).toBe(400);
    expect(fake.calls.length).toBe(before);
  });

  it('rejects cross-site fetches (Sec-Fetch-Site) with 403 and accepts same-origin', async () => {
    const { app, sessionCookie } = await signedInApp();
    const url = `/dashboard/bff/patients/${PATIENT.p13}/header`;
    const cross = await app.inject({ method: 'GET', url, headers: { 'sec-fetch-site': 'cross-site' }, cookies: { dashboard_sid: sessionCookie } });
    expect(cross.statusCode).toBe(403);
    const same = await app.inject({ method: 'GET', url, headers: { 'sec-fetch-site': 'same-origin' }, cookies: { dashboard_sid: sessionCookie } });
    expect(same.statusCode).toBe(200);
  });

  it('rejects an invalid patient id or MRN with 400 before any upstream call', async () => {
    const { app, fake, sessionCookie } = await signedInApp();
    const before = fake.calls.length;
    for (const url of ['/dashboard/bff/patients/13/header', '/dashboard/bff/patients/by-mrn/a%20b']) {
      const res = await app.inject({ method: 'GET', url, cookies: { dashboard_sid: sessionCookie } });
      expect(res.statusCode, url).toBe(400);
    }
    expect(fake.calls.length).toBe(before);
  });

  it('rejects a tampered session cookie', async () => {
    const { app, sessionCookie } = await signedInApp();
    const tampered = `${sessionCookie.slice(0, -2)}xx`;
    const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p13}/header`, cookies: { dashboard_sid: tampered } });
    expect(res.statusCode).toBe(401);
  });
});

describe('cookies and token confinement', () => {
  it('session cookie is HttpOnly, SameSite=Lax, Path=/dashboard; Secure under an https (production) config', async () => {
    const fake = new FakeOpenEmr();
    const signer = await makeIdTokenSigner();
    const prod = await buildTestApp({
      fake,
      config: testConfig({ DASHBOARD_PUBLIC_ORIGIN: 'https://host.test', DASHBOARD_OAUTH_ISSUER: 'https://host.test/oauth2/default', NODE_ENV: 'production' }),
    });
    const login = await prod.inject({ method: 'GET', url: '/dashboard/login' });
    const txCookie = [login.headers['set-cookie']].flat().find((c) => c?.startsWith('dashboard_tx=')) ?? '';
    expect(txCookie).toMatch(/Secure/);
    const q = new URL(String(login.headers.location)).searchParams;
    const idToken = await signer.sign({ nonce: q.get('nonce') }, { issuer: 'https://host.test/oauth2/default' });
    fake.on('POST', 'http://openemr/oauth2/default/token', { status: 200, body: { access_token: SYNTHETIC_ACCESS_TOKEN, id_token: idToken, token_type: 'Bearer', expires_in: 3600 } });
    fake.on('GET', 'http://openemr/oauth2/default/jwk', { status: 200, body: signer.jwks });
    const tx = (txCookie.split(';')[0] ?? '').replace('dashboard_tx=', '');
    const cb = await prod.inject({ method: 'GET', url: `/dashboard/callback?code=c&state=${q.get('state') ?? ''}`, cookies: { dashboard_tx: tx } });
    const sid = [cb.headers['set-cookie']].flat().find((c) => c?.startsWith('dashboard_sid=')) ?? '';
    expect(sid).toMatch(/HttpOnly/);
    expect(sid).toMatch(/SameSite=Lax/);
    expect(sid).toMatch(/Path=\/dashboard/);
    expect(sid).toMatch(/Secure/);

    const dev = await signedInApp();
    const devLogin = await dev.app.inject({ method: 'GET', url: '/dashboard/login' });
    expect([devLogin.headers['set-cookie']].flat().join(';')).not.toMatch(/Secure/);
  });

  it('no response body anywhere carries a token, the client secret or a JWT', async () => {
    const { app, sessionCookie } = await signedInApp();
    const urls = [
      '/dashboard/',
      '/dashboard/health',
      '/dashboard/bff/session',
      `/dashboard/bff/patients/${PATIENT.p13}/header`,
      `/dashboard/bff/patients/${PATIENT.p12}/header`,
      '/dashboard/login',
    ];
    for (const url of urls) {
      const res = await app.inject({ method: 'GET', url, cookies: { dashboard_sid: sessionCookie } });
      for (const needle of ['access_token', 'refresh_token', 'id_token', 'client_secret', SYNTHETIC_ACCESS_TOKEN, TEST_ENV.DASHBOARD_OAUTH_CLIENT_SECRET]) {
        expect(res.body, `${url} contains ${needle}`).not.toContain(needle);
      }
      expect(JWT_RE.test(res.body), `${url} contains a JWT`).toBe(false);
    }
  });

  it('the header endpoint returns the DTO only (no raw upstream fields)', async () => {
    const { app, sessionCookie } = await signedInApp();
    const res = await app.inject({ method: 'GET', url: `/dashboard/bff/patients/${PATIENT.p12}/header`, cookies: { dashboard_sid: sessionCookie } });
    const card: unknown = res.json();
    expect(card).toMatchObject({ kind: 'ok', patientId: PATIENT.p12, rows: [{ status: 'Deceased', ageLabel: 'Age at death' }] });
    expect(res.body).not.toContain('resourceType');
    expect(res.body).not.toContain('"pid"');
  });
});
