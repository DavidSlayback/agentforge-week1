import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REFERRER_POLICY } from '../../bff/src/http/security.ts';
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
  it('sends CSP, a strict-origin referrer policy and nosniff everywhere, and no-store on /bff, /login, /callback, /logout', async () => {
    const { app, sessionCookie } = await signedInApp();
    const spa = await app.inject({ method: 'GET', url: '/dashboard/' });
    expect(spa.statusCode).toBe(200);
    expect(spa.headers['content-security-policy']).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://openemr.test",
    );
    expect(spa.headers['referrer-policy']).toBe('strict-origin');
    expect(spa.headers['x-content-type-options']).toBe('nosniff');
    for (const url of [`/dashboard/bff/patients/${PATIENT.p13}/header`, '/dashboard/bff/session', '/dashboard/login']) {
      const res = await app.inject({ method: 'GET', url, cookies: { dashboard_sid: sessionCookie } });
      expect(res.headers['cache-control'], url).toBe('no-store');
      expect(res.headers['content-security-policy'], url).toBeDefined();
    }
  });

  it('uses a referrer policy under which the sign-out POST carries a real Origin and no Referer carries the patient uuid', () => {
    // Real-browser finding (docs/legacy-audit/evidence/a11y/README.md, K-1): under `no-referrer`,
    // Chromium sends `Origin: null` on the same-origin sign-out form POST (Fetch "serialize a request
    // origin"), so the logout Origin check answered 403 and nobody could sign out. `same-origin`
    // would fix that but send the full path (the puuid) to OpenEMR, which shares the production
    // origin. Only these two keep a real Origin on same-origin POSTs and never send a path.
    expect(['strict-origin', 'origin']).toContain(REFERRER_POLICY);
    // The SPA's own meta tag must say the same, or the document policy overrides the header.
    const html = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
    expect(/<meta name="referrer" content="([^"]+)"/.exec(html)?.[1]).toBe(REFERRER_POLICY);
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

describe('static file serving', () => {
  // W3 hardening H4: @fastify/static <= 10.1.1 has a high advisory (GHSA-pr96-94w5-mx2h, GHSA-x428-ghpx-8j92,
  // GHSA-8pvw-jcv7-9cmj, GHSA-83w8-p2f5-377r: traversal and route-guard bypass via encoded paths).
  it('runs a patched @fastify/static (>= 10.1.5)', () => {
    const pkg: unknown = JSON.parse(readFileSync(new URL('../../node_modules/@fastify/static/package.json', import.meta.url), 'utf8'));
    const version = typeof pkg === 'object' && pkg !== null && 'version' in pkg && typeof pkg.version === 'string' ? pkg.version : '0.0.0';
    const [major = 0, minor = 0, patch = 0] = version.split('.').map((n) => Number.parseInt(n, 10));
    expect(major * 1e6 + minor * 1e3 + patch, version).toBeGreaterThanOrEqual(10 * 1e6 + 1 * 1e3 + 5);
  });

  it('never serves a file outside the built SPA, whatever the encoding', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'dashboard-static-parent-'));
    const root = join(parent, 'dist');
    mkdirSync(root);
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>Patient Dashboard</title><div id="root"></div>');
    writeFileSync(join(parent, 'outside.txt'), 'OUTSIDE-THE-SPA-MARKER');
    const app = await buildTestApp({ fake: new FakeOpenEmr(), config: testConfig({}, root) });
    for (const url of [
      '/dashboard/../outside.txt',
      '/dashboard/..%2foutside.txt',
      '/dashboard/%2e%2e/outside.txt',
      '/dashboard/%2e%2e%2foutside.txt',
      '/dashboard/..%5coutside.txt',
      '/dashboard/%252e%252e/outside.txt',
      '/dashboard/patients/..%2f..%2foutside.txt',
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.body, url).not.toContain('OUTSIDE-THE-SPA-MARKER');
    }
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

  // W3 hardening H4: the guards once prefix-matched the raw URL while the router matches the decoded
  // path, so `/dashboard/%62ff/...` reached the header handler cross-site, with a query string and
  // without `no-store`. Every spelling that reaches a /bff handler must meet the same guards.
  it('applies the /bff guards to every encoding of the path the router decodes (%62ff, %2F, double encoding, case, dots)', async () => {
    const { app, fake, sessionCookie } = await signedInApp();
    const cookies = { dashboard_sid: sessionCookie };
    const P = PATIENT.p13;
    const variants = [
      `/dashboard/%62ff/patients/${P}/header`,
      `/dashboard/%62%66%66/patients/${P}/header`,
      `/%64ashboard/bff/patients/${P}/header`,
      `/dashboard/%62ff/patients/${P}/heade%72`,
      `/dashboard/%62ff/session`,
      `/dashboard/%42ff/patients/${P}/header`,
      `/dashboard/BFF/patients/${P}/header`,
      `/dashboard/bff%2Fpatients/${P}/header`,
      `/dashboard/bff/patients%2F${P}/header`,
      `/dashboard/%2562ff/patients/${P}/header`,
      `/dashboard/bff/patients/${P}/header/`,
      `/dashboard/bff/patients/${P}/header.`,
      `/dashboard/./bff/patients/${P}/header`,
      `/dashboard/x/../bff/patients/${P}/header`,
      `/dashboard/%2e/bff/patients/${P}/header`,
      `/dashboard/bff/patients/${P}/header;x`,
    ];
    let reachedHandler = 0;
    for (const url of variants) {
      const before = fake.calls.length;
      const cross = await app.inject({ method: 'GET', url, headers: { 'sec-fetch-site': 'cross-site' }, cookies });
      expect(cross.statusCode, `cross-site ${url}`).not.toBe(200);
      expect(fake.calls.length, `cross-site ${url} called upstream`).toBe(before);
      const query = await app.inject({ method: 'GET', url: `${url}?_sort=x`, headers: { 'sec-fetch-site': 'same-origin' }, cookies });
      expect(query.statusCode, `query ${url}`).not.toBe(200);
      expect(fake.calls.length, `query ${url} called upstream`).toBe(before);
      const same = await app.inject({ method: 'GET', url, headers: { 'sec-fetch-site': 'same-origin' }, cookies });
      if (same.statusCode === 200) {
        reachedHandler += 1;
        expect(cross.statusCode, `cross-site ${url}`).toBe(403);
        expect(query.statusCode, `query ${url}`).toBe(400);
        expect(same.headers['cache-control'], `no-store ${url}`).toBe('no-store');
      }
    }
    // The probe is only meaningful if some encodings do reach a handler (the router decodes them).
    expect(reachedHandler).toBeGreaterThanOrEqual(4);
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
